//! Records what other apps play — the other people in a Teams, Zoom or Meet
//! call — so meeting notes include both sides, not only the microphone.
//!
//! macOS 14.2+ "process taps": a private, mono tap of everything the computer
//! plays (except Utter's own sounds) is attached to a private aggregate device,
//! whose IO callback collects the samples. The first start asks the user for
//! "System Audio Recording" permission (`NSAudioCaptureUsageDescription`); if
//! it's refused, the tap only delivers silence, which mixes in harmlessly.

use std::sync::Mutex;

/// Mono samples at the tap's native rate, collected by the IO callback.
struct Shared {
    samples: Mutex<Vec<f32>>,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Shared;
    use log::{debug, warn};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_core_audio::*;
    use objc2_core_audio_types::{AudioBuffer, AudioBufferList, AudioStreamBasicDescription};
    use objc2_core_foundation::{CFDictionary, CFRetained, CFString};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSUUID};
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::Mutex;

    /// `kAudioFormatFlagIsFloat`.
    const FORMAT_FLAG_IS_FLOAT: u32 = 1;

    pub struct Capture {
        tap: AudioObjectID,
        device: AudioObjectID,
        proc_id: AudioDeviceIOProcID,
        rate: f64,
        shared: *mut Shared,
    }

    // The raw pointer is only touched by the IO callback and by `stop`, which
    // tears the callback down before freeing it.
    unsafe impl Send for Capture {}

    fn address(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn check(status: i32, what: &str) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!("{what} failed (OSStatus {status})"))
        }
    }

    fn any<T: objc2::Message>(object: Retained<T>) -> Retained<AnyObject> {
        // SAFETY: every Objective-C object is an AnyObject.
        unsafe { Retained::cast_unchecked(object) }
    }

    fn key(name: &std::ffi::CStr) -> Retained<NSString> {
        NSString::from_str(name.to_str().unwrap_or_default())
    }

    /// Utter's own audio object, so its feedback sounds stay out of the tap.
    fn own_process_object() -> Option<AudioObjectID> {
        let pid: i32 = std::process::id() as i32;
        let mut object: AudioObjectID = 0;
        let mut size = std::mem::size_of::<AudioObjectID>() as u32;
        let addr = address(kAudioHardwarePropertyTranslatePIDToProcessObject);
        // SAFETY: valid pointers to locals of the declared sizes.
        let status = unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&addr),
                std::mem::size_of::<i32>() as u32,
                (&pid as *const i32).cast(),
                NonNull::from(&mut size),
                NonNull::from(&mut object).cast(),
            )
        };
        (status == 0 && object != 0).then_some(object)
    }

    /// The UID of the device sound currently plays through: it clocks the
    /// aggregate device.
    fn default_output_uid() -> Option<Retained<NSString>> {
        let mut device: AudioObjectID = 0;
        let mut size = std::mem::size_of::<AudioObjectID>() as u32;
        let addr = address(kAudioHardwarePropertyDefaultOutputDevice);
        // SAFETY: valid pointers to locals of the declared sizes.
        let status = unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut device).cast(),
            )
        };
        if status != 0 || device == 0 {
            return None;
        }
        let mut uid: *const CFString = std::ptr::null();
        let mut size = std::mem::size_of::<*const CFString>() as u32;
        let addr = address(kAudioDevicePropertyDeviceUID);
        // SAFETY: the property is a retained CFStringRef written to `uid`.
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                NonNull::from(&addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut uid).cast(),
            )
        };
        let uid = NonNull::new(uid as *mut CFString)?;
        if status != 0 {
            return None;
        }
        // SAFETY: CoreAudio returns the UID retained (Create rule).
        let uid: CFRetained<CFString> = unsafe { CFRetained::from_raw(uid) };
        Some(NSString::from_str(&uid.to_string()))
    }

    unsafe extern "C-unwind" fn io_proc(
        _device: AudioObjectID,
        _now: NonNull<objc2_core_audio_types::AudioTimeStamp>,
        input: NonNull<AudioBufferList>,
        _input_time: NonNull<objc2_core_audio_types::AudioTimeStamp>,
        _output: NonNull<AudioBufferList>,
        _output_time: NonNull<objc2_core_audio_types::AudioTimeStamp>,
        client: *mut c_void,
    ) -> i32 {
        if client.is_null() {
            return 0;
        }
        // SAFETY: `client` is the `Shared` that `start` leaked and `stop`
        // frees only after this callback is removed.
        let shared = unsafe { &*(client as *const Shared) };
        let list = unsafe { input.as_ref() };
        let count = list.mNumberBuffers as usize;
        if count == 0 {
            return 0;
        }
        // SAFETY: an AudioBufferList holds `mNumberBuffers` buffers inline.
        let buffers: &[AudioBuffer] =
            unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), count) };
        mix_buffers(buffers, &shared.samples);
        0
    }

    /// Averages every channel of every buffer into one mono stream.
    fn mix_buffers(buffers: &[AudioBuffer], out: &Mutex<Vec<f32>>) {
        let frames = buffers
            .iter()
            .map(|b| {
                let ch = b.mNumberChannels.max(1) as usize;
                b.mDataByteSize as usize / (std::mem::size_of::<f32>() * ch)
            })
            .min()
            .unwrap_or(0);
        if frames == 0 {
            return;
        }
        let mut mono = vec![0.0f32; frames];
        let mut channels_total = 0usize;
        for buffer in buffers {
            if buffer.mData.is_null() {
                continue;
            }
            let ch = buffer.mNumberChannels.max(1) as usize;
            // SAFETY: CoreAudio hands us `mDataByteSize` bytes of f32 samples.
            let data =
                unsafe { std::slice::from_raw_parts(buffer.mData as *const f32, frames * ch) };
            for (f, frame) in data.chunks_exact(ch).enumerate() {
                mono[f] += frame.iter().sum::<f32>();
            }
            channels_total += ch;
        }
        if channels_total == 0 {
            return;
        }
        let scale = 1.0 / channels_total as f32;
        if let Ok(mut samples) = out.lock() {
            samples.extend(mono.into_iter().map(|s| s * scale));
        }
    }

    pub fn start() -> Result<Capture, String> {
        // 1. A private mono tap of everything except Utter itself.
        let exclude: Vec<Retained<NSNumber>> = own_process_object()
            .map(|o| NSNumber::new_u32(o))
            .into_iter()
            .collect();
        let exclude = NSArray::from_retained_slice(&exclude);
        // SAFETY: plain Objective-C initialisers and setters.
        let description = unsafe {
            let d = CATapDescription::initMonoGlobalTapButExcludeProcesses(
                CATapDescription::alloc(),
                &exclude,
            );
            d.setPrivate(true);
            d.setName(&NSString::from_str("Utter call audio"));
            d
        };
        let tap_uuid = unsafe { description.UUID() }.UUIDString();
        let mut tap: AudioObjectID = 0;
        // SAFETY: valid description and out pointer.
        check(
            unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap) },
            "Creating the system audio tap",
        )?;

        let cleanup_tap = |tap| {
            // SAFETY: destroying the tap created above.
            unsafe { AudioHardwareDestroyProcessTap(tap) };
        };

        // 2. The tap's sample format.
        let mut format: AudioStreamBasicDescription = unsafe { std::mem::zeroed() };
        let mut size = std::mem::size_of::<AudioStreamBasicDescription>() as u32;
        let addr = address(kAudioTapPropertyFormat);
        // SAFETY: valid pointers of the declared sizes.
        let status = unsafe {
            AudioObjectGetPropertyData(
                tap,
                NonNull::from(&addr),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut format).cast(),
            )
        };
        if let Err(e) = check(status, "Reading the tap format") {
            cleanup_tap(tap);
            return Err(e);
        }
        if format.mFormatFlags & FORMAT_FLAG_IS_FLOAT == 0 || format.mSampleRate <= 0.0 {
            cleanup_tap(tap);
            return Err("The system audio tap isn't float audio".into());
        }

        // 3. A private aggregate device that reads the tap, clocked by the
        //    current output device.
        let sub_tap = NSDictionary::<NSString, AnyObject>::from_retained_objects(
            &[
                &*key(kAudioSubTapUIDKey),
                &*key(kAudioSubTapDriftCompensationKey),
            ],
            &[any(tap_uuid.clone()), any(NSNumber::new_bool(true))],
        );
        let mut keys: Vec<Retained<NSString>> = vec![
            key(kAudioAggregateDeviceNameKey),
            key(kAudioAggregateDeviceUIDKey),
            key(kAudioAggregateDeviceIsPrivateKey),
            key(kAudioAggregateDeviceIsStackedKey),
            key(kAudioAggregateDeviceTapAutoStartKey),
            key(kAudioAggregateDeviceTapListKey),
        ];
        let mut values: Vec<Retained<AnyObject>> = vec![
            any(NSString::from_str("Utter call capture")),
            any(NSUUID::new().UUIDString()),
            any(NSNumber::new_bool(true)),
            any(NSNumber::new_bool(false)),
            any(NSNumber::new_bool(true)),
            any(NSArray::from_retained_slice(&[sub_tap])),
        ];
        if let Some(output_uid) = default_output_uid() {
            let sub_device = NSDictionary::<NSString, AnyObject>::from_retained_objects(
                &[&*key(kAudioSubDeviceUIDKey)],
                &[any(output_uid.clone())],
            );
            keys.push(key(kAudioAggregateDeviceMainSubDeviceKey));
            values.push(any(output_uid));
            keys.push(key(kAudioAggregateDeviceSubDeviceListKey));
            values.push(any(NSArray::from_retained_slice(&[sub_device])));
        }
        let key_refs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
        let description =
            NSDictionary::<NSString, AnyObject>::from_retained_objects(&key_refs, &values);
        // SAFETY: NSDictionary is toll-free bridged with CFDictionary.
        let cf_description: &CFDictionary =
            unsafe { &*(Retained::as_ptr(&description) as *const CFDictionary) };
        let mut device: AudioObjectID = 0;
        // SAFETY: valid dictionary and out pointer.
        let status = unsafe {
            AudioHardwareCreateAggregateDevice(cf_description, NonNull::from(&mut device))
        };
        if let Err(e) = check(status, "Creating the call capture device") {
            cleanup_tap(tap);
            return Err(e);
        }

        // 4. Collect samples in the IO callback.
        let shared = Box::into_raw(Box::new(Shared {
            samples: Mutex::new(Vec::new()),
        }));
        let mut proc_id: AudioDeviceIOProcID = None;
        // SAFETY: the callback reads `shared` until `stop` removes it.
        let status = unsafe {
            AudioDeviceCreateIOProcID(
                device,
                Some(io_proc),
                shared.cast(),
                NonNull::from(&mut proc_id),
            )
        };
        let started = check(status, "Registering the capture callback").and_then(|()| {
            // SAFETY: starting the device we created with our callback.
            check(
                unsafe { AudioDeviceStart(device, proc_id) },
                "Starting call capture",
            )
        });
        if let Err(e) = started {
            // SAFETY: tearing down what was created above, callback first.
            unsafe {
                if proc_id.is_some() {
                    AudioDeviceDestroyIOProcID(device, proc_id);
                }
                AudioHardwareDestroyAggregateDevice(device);
                drop(Box::from_raw(shared));
            }
            cleanup_tap(tap);
            return Err(e);
        }

        debug!(
            "System audio capture started at {} Hz ({} channel tap)",
            format.mSampleRate, format.mChannelsPerFrame
        );
        Ok(Capture {
            tap,
            device,
            proc_id,
            rate: format.mSampleRate,
            shared,
        })
    }

    impl Capture {
        /// Stops capturing; returns mono samples and their sample rate.
        pub fn stop(self) -> (Vec<f32>, u32) {
            // SAFETY: stop and remove the callback before freeing what it
            // reads; then destroy the device and the tap.
            let samples = unsafe {
                AudioDeviceStop(self.device, self.proc_id);
                AudioDeviceDestroyIOProcID(self.device, self.proc_id);
                AudioHardwareDestroyAggregateDevice(self.device);
                AudioHardwareDestroyProcessTap(self.tap);
                let shared = Box::from_raw(self.shared);
                shared
                    .samples
                    .into_inner()
                    .unwrap_or_else(|e| e.into_inner())
            };
            if samples.is_empty() {
                warn!("System audio capture recorded nothing");
            }
            (samples, self.rate.round() as u32)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub struct Capture;
    pub fn start() -> Result<Capture, String> {
        Err("Recording other apps' audio is only available on macOS".into())
    }
    impl Capture {
        pub fn stop(self) -> (Vec<f32>, u32) {
            (Vec::new(), 16_000)
        }
    }
}

/// The capture running for the current recording, if any.
static ACTIVE: Mutex<Option<imp::Capture>> = Mutex::new(None);

/// Starts recording other apps' audio alongside the microphone. Replaces any
/// capture left over from an earlier recording.
pub fn start() {
    let previous = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(previous) = previous {
        let _ = previous.stop();
    }
    match imp::start() {
        Ok(capture) => {
            *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some(capture);
        }
        Err(e) => log::warn!("Not recording call audio: {e}"),
    }
}

/// Stops the capture and returns its audio at 16 kHz mono, or `None` when
/// none was running (or it recorded nothing usable).
pub fn stop() -> Option<Vec<f32>> {
    let capture = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take()?;
    let (samples, rate) = capture.stop();
    if samples.is_empty() {
        return None;
    }
    match crate::audio_toolkit::audio::resample_to_16k(&samples, rate) {
        Ok(resampled) => Some(resampled),
        Err(e) => {
            log::warn!("Could not convert call audio: {e}");
            None
        }
    }
}

/// Drops a running capture without using its audio (the recording was
/// cancelled).
pub fn discard() {
    if let Some(capture) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = capture.stop();
    }
}

/// Mixes the call audio into the microphone recording, aligned at the start.
/// Loud speech on both sides is clamped rather than wrapping, and the result is
/// as long as the longer of the two.
pub fn mix_into(mic: &mut Vec<f32>, call: &[f32]) {
    if call.is_empty() {
        return;
    }
    if mic.len() < call.len() {
        mic.resize(call.len(), 0.0);
    }
    for (m, c) in mic.iter_mut().zip(call) {
        *m = (*m + *c).clamp(-1.0, 1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::mix_into;

    #[test]
    fn mixing_keeps_both_sides_and_the_longer_length() {
        let mut mic = vec![0.1, 0.2];
        mix_into(&mut mic, &[0.3, 0.3, 0.5]);
        assert_eq!(mic.len(), 3);
        assert!((mic[0] - 0.4).abs() < 1e-6);
        assert!((mic[2] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn mixing_never_clips() {
        let mut mic = vec![0.9];
        mix_into(&mut mic, &[0.9]);
        assert_eq!(mic, vec![1.0]);
    }

    #[test]
    fn no_call_audio_leaves_the_mic_alone() {
        let mut mic = vec![0.25, -0.25];
        mix_into(&mut mic, &[]);
        assert_eq!(mic, vec![0.25, -0.25]);
    }
}

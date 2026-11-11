//! Bluetooth headset microphones only work in the headset ("call") profile:
//! 16 kHz, heavily compressed, often near-silent until the link settles, and
//! it drops the headphones' playback quality while recording. Dictation from
//! them regularly comes back empty. When the system default input is such a
//! mic and the Mac has a built-in one, Utter records from the built-in mic.

/// The built-in microphone's name, when the default input is a Bluetooth
/// headset and a built-in microphone exists. `None` otherwise.
#[cfg(target_os = "macos")]
pub fn builtin_mic_instead_of_bluetooth() -> Option<String> {
    macos::builtin_instead_of_bluetooth()
}

#[cfg(not(target_os = "macos"))]
pub fn builtin_mic_instead_of_bluetooth() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::ptr::{null, NonNull};

    use objc2_core_audio::{
        kAudioDevicePropertyStreams, kAudioDevicePropertyTransportType,
        kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE,
        kAudioDeviceTransportTypeBuiltIn, kAudioHardwarePropertyDefaultInputDevice,
        kAudioHardwarePropertyDevices, kAudioObjectPropertyElementMain, kAudioObjectPropertyName,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeInput, kAudioObjectSystemObject,
        AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
        AudioObjectPropertyAddress, AudioObjectPropertyScope, AudioObjectPropertySelector,
    };
    use objc2_core_foundation::{CFRetained, CFString};

    pub fn builtin_instead_of_bluetooth() -> Option<String> {
        let default = scalar(
            kAudioObjectSystemObject as AudioObjectID,
            kAudioHardwarePropertyDefaultInputDevice,
        )?;
        if !is_bluetooth(default) {
            return None;
        }
        let builtin = ids(
            kAudioObjectSystemObject as AudioObjectID,
            kAudioHardwarePropertyDevices,
            kAudioObjectPropertyScopeGlobal,
        )
        .into_iter()
        .find(|&d| {
            scalar(d, kAudioDevicePropertyTransportType) == Some(kAudioDeviceTransportTypeBuiltIn)
                && !ids(
                    d,
                    kAudioDevicePropertyStreams,
                    kAudioObjectPropertyScopeInput,
                )
                .is_empty()
        })?;
        name(builtin)
    }

    fn is_bluetooth(device: AudioObjectID) -> bool {
        scalar(device, kAudioDevicePropertyTransportType).is_some_and(|t| {
            t == kAudioDeviceTransportTypeBluetooth || t == kAudioDeviceTransportTypeBluetoothLE
        })
    }

    fn address(
        selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope,
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    /// A property holding an array of object IDs.
    fn ids(
        object: AudioObjectID,
        selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope,
    ) -> Vec<AudioObjectID> {
        let address = address(selector, scope);
        let mut size = 0u32;
        // SAFETY: the address and size outlive the call.
        let status = unsafe {
            AudioObjectGetPropertyDataSize(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
            )
        };
        if status != 0 || size == 0 {
            return Vec::new();
        }
        let mut out = vec![0 as AudioObjectID; size as usize / size_of::<AudioObjectID>()];
        let mut size = (out.len() * size_of::<AudioObjectID>()) as u32;
        // SAFETY: `out` has room for `size` bytes; CoreAudio writes at most
        // that many and updates `size`.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::new(out.as_mut_ptr()).unwrap().cast::<c_void>(),
            )
        };
        if status != 0 {
            return Vec::new();
        }
        out.truncate(size as usize / size_of::<AudioObjectID>());
        out
    }

    fn scalar(object: AudioObjectID, selector: AudioObjectPropertySelector) -> Option<u32> {
        let address = address(selector, kAudioObjectPropertyScopeGlobal);
        let mut value = 0u32;
        let mut size = size_of::<u32>() as u32;
        // SAFETY: `value` has room for the `size` bytes CoreAudio may write.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        };
        (status == 0 && size == size_of::<u32>() as u32).then_some(value)
    }

    fn name(device: AudioObjectID) -> Option<String> {
        let address = address(kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal);
        let mut name: *mut CFString = std::ptr::null_mut();
        let mut size = size_of::<*mut CFString>() as u32;
        // SAFETY: the name property is a CFString returned under the create
        // rule (+1), which `CFRetained::from_raw` takes over.
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::from(&mut name).cast(),
            )
        };
        if status != 0 {
            return None;
        }
        let name = NonNull::new(name)?;
        // SAFETY: see above; non-null and owned.
        Some(unsafe { CFRetained::from_raw(name) }.to_string())
    }

    #[cfg(test)]
    mod tests {
        /// Prints what this Mac reports; run with `--ignored --nocapture`.
        #[test]
        #[ignore = "reads this machine's audio devices"]
        fn report_this_mac() {
            println!(
                "built-in instead of Bluetooth: {:?}",
                super::builtin_instead_of_bluetooth()
            );
            let default = super::scalar(
                super::kAudioObjectSystemObject as super::AudioObjectID,
                super::kAudioHardwarePropertyDefaultInputDevice,
            );
            println!(
                "default input: {:?} bluetooth={:?}",
                default.and_then(super::name),
                default.map(super::is_bluetooth)
            );
        }
    }
}

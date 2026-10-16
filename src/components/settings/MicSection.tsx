import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { listInputDevices, startMicTest, stopMicTest, type InputDevice } from "../../lib/ipc";
import { MicMeter } from "./MicMeter";

/**
 * The microphone block of the Audio tab: the input device, and a Test that runs the meter only
 * (nothing is transcribed). A running test ends when this section unmounts (the tab changes or the drawer
 * closes), when a meeting leaves idle (Rust closes the test then), and when Sidekick hides. Changing the
 * device restarts a running test on the new device.
 */
export const MicSection: React.FC = () => {
  const micDeviceName = useSettingsStore((s) => s.micDeviceName);
  const setMicDevice = useSettingsStore((s) => s.setMicDevice);
  const meetingStatus = useAppStore((s) => s.meetingStatus);
  const isVisible = useAppStore((s) => s.isVisible);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const testingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    listInputDevices().then((list) => {
      if (mountedRef.current && list) setDevices(list);
    });
    return () => {
      mountedRef.current = false;
      if (testingRef.current) {
        testingRef.current = false;
        void stopMicTest();
      }
    };
  }, []);

  const stopTest = () => {
    testingRef.current = false;
    setTesting(false);
    return stopMicTest();
  };

  // Rust ends the test itself when a meeting starts or on panic, and nobody sees the meter while hidden
  useEffect(() => {
    if (testingRef.current && (meetingStatus !== "idle" || !isVisible)) void stopTest();
  }, [meetingStatus, isVisible]);

  const startTest = async () => {
    setTestError(null);
    try {
      await startMicTest();
      // The section closed while the test was starting: don't leave the microphone running
      if (!mountedRef.current) {
        void stopMicTest();
        return;
      }
      testingRef.current = true;
      setTesting(true);
    } catch (err) {
      if (!mountedRef.current) return;
      // Rust rejects with a message the user can read, e.g. mic denied or recording in progress
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : "";
      setTestError(message || "Couldn't start the microphone test.");
    }
  };

  const toggleTest = () => {
    if (testingRef.current) void stopTest();
    else void startTest();
  };

  // The meter measures the device it started on, so a change restarts a running test on the new one
  const changeDevice = async (name: string | null) => {
    const wasTesting = testingRef.current;
    if (wasTesting) await stopTest();
    await setMicDevice(name);
    if (wasTesting && mountedRef.current) await startTest();
  };

  const defaultDevice = devices.find((d) => d.isDefault);
  // A saved device that isn't listed right now stays selectable, so the choice isn't silently lost
  const savedMissing = micDeviceName && !devices.some((d) => d.name === micDeviceName) ? micDeviceName : null;

  return (
    <div className="space-y-2 rounded-lg bg-sk-fill p-3">
      <h3 className="sk-label">Microphone</h3>
      <div className="space-y-1.5">
        <label htmlFor="mic-device" className="sk-meta">
          Input device
        </label>
        <select
          id="mic-device"
          value={micDeviceName ?? ""}
          onChange={(e) => void changeDevice(e.target.value || null)}
          className="sk-field"
        >
          <option value="">{defaultDevice ? `System default (${defaultDevice.name})` : "System default"}</option>
          {devices.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
          {savedMissing && <option value={savedMissing}>{`${savedMissing} (not connected)`}</option>}
        </select>
        <p className="sk-meta">Applies from the next Start.</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <MicMeter active={testing} />
        </div>
        <button
          type="button"
          onClick={toggleTest}
          disabled={meetingStatus !== "idle"}
          className="sk-btn-secondary shrink-0"
        >
          {testing ? "Stop test" : "Test"}
        </button>
      </div>
      <p className="sk-meta">
        {meetingStatus === "idle"
          ? "The test uses the microphone only. Nothing is transcribed."
          : "Stop listening before testing the microphone."}
      </p>
      {testError && (
        <p role="alert" className="sk-meta text-sk-danger">
          {testError}
        </p>
      )}
    </div>
  );
};

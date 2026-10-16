import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSettingsStore, type SettingsState } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import * as ipc from "../lib/ipc";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("modes, languages and microphone in settings", () => {
  let invoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    invoke = vi.spyOn(ipc, "safeInvoke").mockResolvedValue(null);
    useSettingsStore.getState().resetSettings();
    useSettingsStore.setState({ modes: [] }); // reset keeps custom modes
    useSessionStore.getState().clearSession();
    invoke.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with General active, English both ways, the system microphone and no custom modes", () => {
    const s = useSettingsStore.getState();
    expect(s.modes).toEqual([]);
    expect(s.activeModeId).toBe("general");
    expect(s.sttLanguage).toBe("en");
    expect(s.outputLanguage).toBe("English");
    expect(s.micDeviceName).toBeNull();
  });

  it("adds, edits and deletes custom modes", () => {
    const id = useSettingsStore.getState().addMode("  Pair programming ", " Think out loud. ");
    expect(useSettingsStore.getState().modes).toEqual([{ id, name: "Pair programming", prompt: "Think out loud." }]);

    useSettingsStore.getState().updateMode(id, { name: "Pairing" });
    expect(useSettingsStore.getState().modes[0]).toMatchObject({ id, name: "Pairing", prompt: "Think out loud." });

    useSettingsStore.getState().deleteMode(id);
    expect(useSettingsStore.getState().modes).toEqual([]);
  });

  it("deleting the active custom mode falls back to General", () => {
    const id = useSettingsStore.getState().addMode("Mine", "Be brief.");
    useSettingsStore.getState().setActiveMode(id);
    useSettingsStore.getState().deleteMode(id);
    expect(useSettingsStore.getState().activeModeId).toBe("general");
  });

  it("choosing Coding turns the options' screen on, and leaving Coding turns it off", () => {
    expect(useSessionStore.getState().optionsUseScreen).toBe(false);

    useSettingsStore.getState().setActiveMode("coding");
    expect(useSessionStore.getState().optionsUseScreen).toBe(true);

    useSettingsStore.getState().setActiveMode("behavioral");
    expect(useSessionStore.getState().optionsUseScreen).toBe(false);
  });

  it("other mode changes leave the options' screen toggle as the user set it", () => {
    useSessionStore.setState({ optionsUseScreen: true });
    useSettingsStore.getState().setActiveMode("system_design");
    expect(useSessionStore.getState().optionsUseScreen).toBe(true);
  });

  it("resetting settings from Coding turns the screen back off and returns to General", () => {
    useSettingsStore.getState().setActiveMode("coding");
    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().activeModeId).toBe("general");
    expect(useSessionStore.getState().optionsUseScreen).toBe(false);
  });

  it("pushes the transcription language to Rust and keeps the warning it returns", async () => {
    invoke.mockResolvedValue("The on-device model only transcribes English.");

    useSettingsStore.getState().setSttLanguage("hi");
    await flush();

    expect(invoke).toHaveBeenCalledWith("set_stt_language", { language: "hi" });
    expect(useSettingsStore.getState().sttLanguageNotice).toBe("The on-device model only transcribes English.");

    invoke.mockResolvedValue(null);
    useSettingsStore.getState().setSttLanguage("en");
    await flush();
    expect(useSettingsStore.getState().sttLanguageNotice).toBeNull();
  });

  it("checks the language again after the engine is set, so the warning follows the engine", async () => {
    const calls: string[] = [];
    invoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      return null;
    });

    useSettingsStore.getState().setSttMode("groq");
    await flush();

    expect(calls).toEqual(["set_stt_engine", "set_stt_language"]);
  });

  it("keeps custom modes across a reset, like API keys, and goes back to General", () => {
    const id = useSettingsStore.getState().addMode("Pair programming", "Think out loud.");
    useSettingsStore.getState().setActiveMode(id);
    useSettingsStore.getState().setSeniority("principal");

    useSettingsStore.getState().resetSettings();

    const s = useSettingsStore.getState();
    expect(s.modes).toEqual([{ id, name: "Pair programming", prompt: "Think out loud." }]);
    expect(s.activeModeId).toBe("general");
    expect(s.profile.seniorityPreset).toBe("senior");
  });

  it("pushes the microphone choice to Rust, null for the system default", () => {
    useSettingsStore.getState().setMicDevice("USB Microphone");
    expect(useSettingsStore.getState().micDeviceName).toBe("USB Microphone");
    expect(invoke).toHaveBeenCalledWith("set_mic_device", { name: "USB Microphone" });

    useSettingsStore.getState().setMicDevice(null);
    expect(invoke).toHaveBeenLastCalledWith("set_mic_device", { name: null });
  });

  it("does not save the STT note with the other settings", () => {
    useSettingsStore.setState({ sttLanguageNotice: "English only" });
    const raw = JSON.parse(localStorage.getItem("sidekick-settings")!);
    expect(raw.state.sttLanguageNotice).toBeUndefined();
  });
});

describe("persisted settings migration (version 1 -> 2)", () => {
  const migrate = useSettingsStore.persist.getOptions().migrate!;

  it("gives the new fields their defaults and keeps the saved ones", () => {
    const migrated = migrate({ selectedModel: "anthropic/claude-haiku-5.5", sttMode: "groq" }, 1) as SettingsState;

    expect(migrated.modes).toEqual([]);
    expect(migrated.activeModeId).toBe("general");
    expect(migrated.sttLanguage).toBe("en");
    expect(migrated.outputLanguage).toBe("English");
    expect(migrated.micDeviceName).toBeNull();
    expect(migrated.sttMode).toBe("groq");
  });
});

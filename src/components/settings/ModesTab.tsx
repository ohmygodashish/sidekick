import React, { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { PRESET_MODES } from "../../services/ai/modes";

/** A custom mode being written: id null for a new one. */
interface Draft {
  id: string | null;
  name: string;
  prompt: string;
}

const SetActive: React.FC<{ active: boolean; onSet: () => void }> = ({ active, onSet }) =>
  active ? (
    <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-sk-accent">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Active
    </span>
  ) : (
    <button type="button" onClick={onSet} className="sk-btn-secondary shrink-0">
      Set active
    </button>
  );

interface ModeFormProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}

const ModeForm: React.FC<ModeFormProps> = ({ draft, onChange, onSave, onCancel }) => (
  <form
    className="space-y-2 rounded-lg bg-sk-fill p-3"
    onSubmit={(e) => {
      e.preventDefault();
      onSave();
    }}
  >
    <div className="space-y-1.5">
      <label htmlFor="mode-name" className="sk-label">
        Name
      </label>
      {/* Focus moves here only when the user clicks New mode */}
      <input
        id="mode-name"
        type="text"
        value={draft.name}
        autoFocus={draft.id === null}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="e.g. Pair programming"
        className="sk-field"
      />
    </div>
    <div className="space-y-1.5">
      <label htmlFor="mode-prompt" className="sk-label">
        Prompt
      </label>
      <textarea
        id="mode-prompt"
        rows={5}
        value={draft.prompt}
        onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
        placeholder="How answers should be shaped while this mode is active"
        className="sk-field resize-none"
      />
    </div>
    <div className="flex items-center gap-2">
      <button
        type="submit"
        disabled={!draft.name.trim() || !draft.prompt.trim()}
        className="sk-btn-primary"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className="sk-btn-secondary">
        Cancel
      </button>
    </div>
  </form>
);

/** Presets (read-only) and the user's custom modes. Any mode can be set active. */
export const ModesTab: React.FC = () => {
  const modes = useSettingsStore((s) => s.modes);
  const activeModeId = useSettingsStore((s) => s.activeModeId);
  const setActiveMode = useSettingsStore((s) => s.setActiveMode);
  const addMode = useSettingsStore((s) => s.addMode);
  const updateMode = useSettingsStore((s) => s.updateMode);
  const deleteMode = useSettingsStore((s) => s.deleteMode);
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    if (!name || !prompt) return;
    if (draft.id) updateMode(draft.id, { name, prompt });
    else addMode(name, prompt);
    setDraft(null);
  };

  return (
    <div className="space-y-4">
      <p className="sk-meta">
        A mode shapes every answer and the live questions. Resume and job description stay in Profile.
      </p>

      <div className="space-y-2">
        <h3 className="sk-label">Presets</h3>
        <ul className="space-y-1">
          {PRESET_MODES.map((mode) => (
            <li key={mode.id} className="flex items-center gap-2 rounded-lg bg-sk-fill px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-sk-fg">{mode.name}</p>
                <p className="sk-meta">{mode.description}</p>
              </div>
              <SetActive active={mode.id === activeModeId} onSet={() => setActiveMode(mode.id)} />
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="sk-label">Custom</h3>
          {/* Starting another draft would drop the unsaved one, so these wait until it is saved or cancelled */}
          <button
            type="button"
            onClick={() => setDraft({ id: null, name: "", prompt: "" })}
            disabled={draft !== null}
            className="sk-btn-secondary"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New mode
          </button>
        </div>

        {draft?.id === null && (
          <ModeForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
        )}

        {modes.length === 0 && draft?.id !== null && (
          <p className="sk-meta">No custom modes yet. Add one for a role or an answer format you use often.</p>
        )}

        <ul className="space-y-1">
          {modes.map((mode) =>
            draft?.id === mode.id ? (
              <li key={mode.id}>
                <ModeForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} />
              </li>
            ) : (
              <li key={mode.id} className="space-y-2 rounded-lg bg-sk-fill p-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-sk-fg">{mode.name}</p>
                  <p className="line-clamp-2 sk-meta">{mode.prompt}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SetActive active={mode.id === activeModeId} onSet={() => setActiveMode(mode.id)} />
                  <button
                    type="button"
                    onClick={() => setDraft({ id: mode.id, name: mode.name, prompt: mode.prompt })}
                    disabled={draft !== null}
                    className="sk-btn-secondary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (draft?.id === mode.id) setDraft(null);
                      deleteMode(mode.id);
                    }}
                    className="sk-btn-secondary"
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      </div>
    </div>
  );
};

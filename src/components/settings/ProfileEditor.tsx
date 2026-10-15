import React, { useState, useRef } from "react";
import {
  User,
  UploadCloud,
  FileText,
  Building,
  Briefcase,
  Check,
  Save,
  Trash2,
  Sparkles,
} from "lucide-react";
import {
  useSettingsStore,
  type TonePreset,
  type SeniorityPreset,
} from "../../store/settingsStore";
import { cn } from "../../lib/utils";

interface ToneOption {
  id: TonePreset;
  title: string;
  badge: string;
  description: string;
}

const TONE_OPTIONS: ToneOption[] = [
  {
    id: "staff",
    title: "Staff Engineer",
    badge: "Pragmatic & Production-Ready",
    description:
      "Balances algorithmic depth with operational reality, maintainability, and trade-offs.",
  },
  {
    id: "concise",
    title: "Concise 3 Bullets",
    badge: "Punchy & High Density",
    description:
      "3 surgical bullet points per question. Ultra-dense recall cues for rapid verbal response.",
  },
  {
    id: "system_architect",
    title: "System Architect",
    badge: "Scalability & CAP Theorem",
    description:
      "Prioritizes distributed systems, failure domains, partition tolerance, and high-availability SLAs.",
  },
];

const SENIORITY_LEVELS: { id: SeniorityPreset; label: string }[] = [
  { id: "junior", label: "Junior" },
  { id: "mid", label: "Mid-Level" },
  { id: "senior", label: "Senior" },
  { id: "staff", label: "Staff" },
  { id: "principal", label: "Principal / Fellow" },
];

export const ProfileEditor: React.FC = () => {
  const { profile, setProfile, setSeniority, setTone } = useSettingsStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        // Do not decode binary PDF bytecode via file.text()
        const sizeKb = Math.round(file.size / 1024);
        setProfile({
          resumeText: `[PDF File Attached: ${file.name} (${sizeKb} KB) - paste extracted text below if needed]`,
        });
      } else {
        const text = await file.text();
        setProfile({ resumeText: text });
      }
    } catch (err) {
      console.error("Failed to parse file", err);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFile(e.target.files[0]);
    }
  };

  const handleClearResume = () => {
    setProfile({ resumeText: "" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const wordCount = profile.resumeText
    ? profile.resumeText.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div data-testid="profile-editor" className="space-y-6">
      {/* Overview Header Card */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <User className="h-3.5 w-3.5 text-sky-400" />
          <span>Interview Personalization & Persona Tuning</span>
        </div>
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Sidekick injects your background, target role, and preferred engineering voice into prompt templates so solutions feel authentic to you.
        </p>
      </div>

      {/* Target Company & Role Context */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-zinc-300">
          Target Role & Company Context
        </h4>

        <div className="space-y-3">
          {/* Target Company */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
              <Building className="h-3 w-3 text-zinc-500" />
              <span>Target Company</span>
            </label>
            <input
              type="text"
              data-testid="target-company-input"
              value={profile.targetCompany}
              onChange={(e) => setProfile({ targetCompany: e.target.value })}
              placeholder="e.g. Stripe, Google, Datadog, Snowflake..."
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Job Description */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
              <Briefcase className="h-3 w-3 text-zinc-500" />
              <span>Job Description & Requirements</span>
            </label>
            <textarea
              rows={3}
              data-testid="job-description-input"
              value={profile.jobDescription}
              onChange={(e) => setProfile({ jobDescription: e.target.value })}
              placeholder="Paste job posting requirements, key systems, tech stack, and evaluation rubric..."
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none font-mono"
            />
          </div>
        </div>
      </section>

      {/* Resume Input Section: Drag-and-drop + Paste Area */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-emerald-400" />
            <span>Candidate Resume / Experience</span>
          </label>
          {profile.resumeText && (
            <div className="flex items-center gap-3 text-[10px] text-zinc-400">
              <span>{wordCount} words</span>
              <span>{profile.resumeText.length} chars</span>
              <button
                type="button"
                data-testid="clear-resume-btn"
                onClick={handleClearResume}
                className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                title="Clear Resume Text"
              >
                <Trash2 className="h-3 w-3" />
                <span>Clear</span>
              </button>
            </div>
          )}
        </div>

        {/* Drag and Drop Zone */}
        <div
          data-testid="resume-dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all",
            isDragging
              ? "border-sky-500 bg-sky-500/10 text-sky-200"
              : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/50 text-zinc-400"
          )}
        >
          <input
            type="file"
            ref={fileInputRef}
            data-testid="resume-file-input"
            onChange={handleFileInputChange}
            accept=".txt,.md,.pdf,.json"
            className="hidden"
          />
          <UploadCloud className="h-6 w-6 mx-auto mb-1.5 text-zinc-400" />
          <p className="text-xs font-medium text-zinc-200">
            Drop your resume file here, or <span className="text-sky-400 underline">browse</span>
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Supports .txt, .md, .pdf, .json
          </p>
        </div>

        {/* Direct Resume Paste / Edit Area */}
        <textarea
          rows={5}
          data-testid="resume-textarea"
          value={profile.resumeText}
          onChange={(e) => setProfile({ resumeText: e.target.value })}
          placeholder="Or paste your resume text, key career highlights, and domain expertise here..."
          className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none font-mono"
        />
      </section>

      {/* Tone & Persona Selector */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span>Tone & Reasoning Persona</span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {TONE_OPTIONS.map((opt) => {
            const isSelected = profile.tonePreset === opt.id;
            const testId =
              opt.id === "staff"
                ? "tone-staff"
                : opt.id === "concise"
                ? "tone-concise"
                : "tone-architect";

            return (
              <button
                key={opt.id}
                type="button"
                data-testid={testId}
                onClick={() => setTone(opt.id)}
                className={cn(
                  "w-full text-left rounded-xl border p-3 transition-all",
                  isSelected
                    ? "border-sky-500/80 bg-sky-950/30 text-sky-100 shadow-sm shadow-sky-950/50"
                    : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700/80 hover:bg-zinc-900/60"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-zinc-100">
                    {opt.title}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full font-medium border",
                      isSelected
                        ? "bg-sky-500/20 text-sky-300 border-sky-500/30"
                        : "bg-zinc-800/80 text-zinc-400 border-zinc-700/50"
                    )}
                  >
                    {opt.badge}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Seniority Selector */}
      <section className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300">
          Seniority Target
        </label>
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY_LEVELS.map((level) => {
            const isSelected = profile.seniorityPreset === level.id;
            return (
              <button
                key={level.id}
                type="button"
                data-testid={`seniority-${level.id}`}
                onClick={() => setSeniority(level.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  isSelected
                    ? "bg-sky-600 text-white border-sky-500 shadow-sm"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700"
                )}
              >
                {level.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Save Button */}
      <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
        <span className="text-[11px] text-zinc-400">
          Profile is persisted locally and applied to candidate prompts.
        </span>
        <button
          type="button"
          data-testid="save-profile-btn"
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-950/40 transition-colors"
        >
          {isSaved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Profile Saved!</span>
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              <span>Save Profile</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

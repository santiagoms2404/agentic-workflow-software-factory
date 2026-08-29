import { computed, ref } from "vue";

export type PaletteId = "awsf-classic" | "forest" | "lavender-slate" | "earthy-obsidian" | "navy-sky" | "warm-rust" | "sunset";
export type ThemeMode = "dark" | "light" | "system";
export type ResolvedThemeMode = Exclude<ThemeMode, "system">;

interface PaletteDefinition {
  id: PaletteId;
  name: string;
  swatches: Record<ResolvedThemeMode, readonly [string, string, string, string, string, string]>;
}

const classic = ["#06080f", "#0d1119", "#131a26", "#232c3d", "#aabdd5", "#f2f5fa"] as const;

export const labPalettes: readonly PaletteDefinition[] = [
  { id: "awsf-classic", name: "AWSF Classic", swatches: { dark: classic, light: classic } },
  {
    id: "forest",
    name: "Forest",
    swatches: {
      dark: ["#051F20", "#0B2B26", "#163832", "#235347", "#8EB69B", "#DAF1DE"],
      light: ["#DAF1DE", "#EAF7EE", "#C6E4CF", "#8EB69B", "#235347", "#051F20"],
    },
  },
  {
    id: "lavender-slate",
    name: "Lavender-slate",
    swatches: {
      dark: ["#323042", "#3F3D4E", "#51505A", "#6C6A78", "#878595", "#D2D3DA"],
      light: ["#D2D3DA", "#E7E8EC", "#BDBDC6", "#A5A4AF", "#51505A", "#323042"],
    },
  },
  {
    id: "earthy-obsidian",
    name: "Earthy Obsidian",
    swatches: {
      dark: ["#050806", "#1C241E", "#2A342C", "#364239", "#748778", "#CBD4CC"],
      light: ["#DDE2DD", "#EFF1EF", "#C4CDC5", "#A2AFA4", "#546357", "#050806"],
    },
  },
  {
    id: "navy-sky",
    name: "Navy / sky",
    swatches: {
      dark: ["#0E1526", "#192B41", "#24405C", "#3A5B7B", "#5C7A99", "#D5E2EE"],
      light: ["#D5E2EE", "#E9F0F6", "#A3BFD9", "#8CA9C4", "#24405C", "#0E1526"],
    },
  },
  {
    id: "warm-rust",
    name: "Warm rust",
    swatches: {
      dark: ["#1F1D20", "#2C2A28", "#3E3D38", "#4A2430", "#A79986", "#E4DDD2"],
      light: ["#E4DDD2", "#F2EEE7", "#A79986", "#B9AE9C", "#46372F", "#1F1D20"],
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    swatches: {
      dark: ["#20212B", "#2D4354", "#3A4A57", "#534145", "#A2A396", "#FED7A5"],
      light: ["#FEF1E2", "#FFFFFF", "#FED7A5", "#E0B98A", "#9E6752", "#20212B"],
    },
  },
] as const;

const STORAGE_KEY = "awsf.lab-palette";
const paletteIds = new Set<PaletteId>(labPalettes.map((item) => item.id));
const modes = new Set<ThemeMode>(["dark", "light", "system"]);
const selectedPalette = ref<PaletteId>("forest");
const selectedMode = ref<ThemeMode>("system");
const systemMode = ref<ResolvedThemeMode>("dark");
const resolvedMode = computed<ResolvedThemeMode>(() => selectedMode.value === "system" ? systemMode.value : selectedMode.value);
let initialized = false;

function applyTheme(): void {
  const appliedMode: ResolvedThemeMode = selectedPalette.value === "awsf-classic" ? "dark" : resolvedMode.value;
  document.documentElement.dataset.theme = selectedPalette.value;
  document.documentElement.dataset.mode = appliedMode;
  document.documentElement.style.colorScheme = appliedMode;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette: selectedPalette.value, mode: selectedMode.value }));
  } catch {
    // A denied storage write must not prevent live theme changes.
  }
}

export function initializeLabPalette(): void {
  if (initialized) return;
  initialized = true;
  const media = matchMedia("(prefers-color-scheme: dark)");
  systemMode.value = media.matches ? "dark" : "light";
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { palette?: unknown; mode?: unknown } | null;
    if (stored && typeof stored.palette === "string" && paletteIds.has(stored.palette as PaletteId)) selectedPalette.value = stored.palette as PaletteId;
    if (stored && typeof stored.mode === "string" && modes.has(stored.mode as ThemeMode)) selectedMode.value = stored.mode as ThemeMode;
  } catch {
    // Invalid or unavailable storage falls back to Forest + System.
  }
  applyTheme();
  media.addEventListener("change", (event) => {
    systemMode.value = event.matches ? "dark" : "light";
    if (selectedMode.value === "system") applyTheme();
  });
}

export function useLabPalette() {
  function choosePalette(next: PaletteId): void {
    selectedPalette.value = next;
    applyTheme();
    persist();
  }
  function chooseMode(next: ThemeMode): void {
    selectedMode.value = next;
    applyTheme();
    persist();
  }
  function swatchesFor(id: PaletteId): readonly string[] {
    const definition = labPalettes.find((item) => item.id === id)!;
    return definition.swatches[resolvedMode.value];
  }
  return { palettes: labPalettes, selectedPalette, selectedMode, resolvedMode, choosePalette, chooseMode, swatchesFor };
}

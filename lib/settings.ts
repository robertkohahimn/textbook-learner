import { getActiveProvider, type ActiveProvider } from "./db";

export type ProviderInfo = {
  id: ActiveProvider;
  label: string;
  available: boolean;
};
export type SettingsState = {
  active: ActiveProvider;
  providers: ProviderInfo[];
};

/** Claude is always available (it falls back to the local CLI); GLM needs a key. */
export function providerInfos(
  env: Record<string, string | undefined> = process.env
): ProviderInfo[] {
  return [
    { id: "claude", label: "Claude", available: true },
    { id: "glm", label: "GLM", available: Boolean(env.GLM_API_KEY) },
  ];
}

export function isProviderAvailable(
  id: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return providerInfos(env).some((p) => p.id === id && p.available);
}

export function settingsState(): SettingsState {
  return { active: getActiveProvider(), providers: providerInfos() };
}

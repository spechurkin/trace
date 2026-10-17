export type UpdateState = {
  intervalDays: UpdateInterval;
  status:
    | 'disabled'
    | 'manual'
    | 'idle'
    | 'checking'
    | 'current'
    | 'downloading'
    | 'ready'
    | 'error'
    | 'installing';
  currentVersion: string;
  version?: string;
  percent?: number;
};

export const updateIntervals = [1, 7, 30] as const;
export type UpdateInterval = (typeof updateIntervals)[number];

export function isUpdateInterval(value: unknown): value is UpdateInterval {
  return updateIntervals.some((interval) => interval === value);
}

export type UpdatePreferences = { intervalDays: UpdateInterval; lastCheck: number };

export function supportsAutoUpdate(
  packaged: boolean,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  installedWindows = false,
): boolean {
  return (
    packaged &&
    ((platform === 'win32' && installedWindows && !env.PORTABLE_EXECUTABLE_FILE) ||
      (platform === 'linux' && !!env.APPIMAGE))
  );
}

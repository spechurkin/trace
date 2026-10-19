import { z } from 'zod';

const name = z.string().trim().min(1).max(512);
const mode = z.enum(['dark', 'light']);
export const themeManifestSchema = z
  .object({
    format: z.literal('clubs/theme'),
    api_version: z.literal(1),
    name,
    description: z.string().max(4096).default(''),
    stylesheet: z.string().min(1).max(1024).endsWith('.css'),
    mode: mode.optional(),
    variants: z
      .array(z.object({ id: name.max(128), name, mode }))
      .max(32)
      .default([]),
  })
  .superRefine((manifest, context) => {
    if (!manifest.mode && !manifest.variants.length)
      context.addIssue({ code: 'custom', message: 'A theme needs a mode or variants' });
    if (new Set(manifest.variants.map((variant) => variant.id)).size !== manifest.variants.length)
      context.addIssue({ code: 'custom', message: 'Duplicate theme variant' });
  });

export type ThemeManifest = z.infer<typeof themeManifestSchema>;
export type UserTheme = {
  id: string;
  variant?: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  stylesheet: string;
};
export type ThemeCatalog = { directory: string; themes: UserTheme[]; warnings: string[] };

export function userThemeKey(theme: Pick<UserTheme, 'id' | 'variant'>): string {
  return `user:${JSON.stringify([theme.id, theme.variant ?? null])}`;
}

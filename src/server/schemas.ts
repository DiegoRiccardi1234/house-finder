import { z } from 'zod';

/** Schemi di validazione per la config editabile dalla UI (PUT /api/config/*). */

export const CitySchema = z.enum(['torino', 'bari']);

export const SearchProfileSchema = z.object({
  id: z.string().min(1),
  city: CitySchema,
  label: z.string().min(1),
  maxPrice: z.number().positive(),
  minRooms: z.number().int().positive().optional(),
  maxRooms: z.number().int().positive().optional(),
});
export const SearchesSchema = z.array(SearchProfileSchema);

export const FbGroupSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  city: CitySchema,
});
export const FbMarketTargetSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
});
export const FbConfigSchema = z.object({
  groups: z.array(FbGroupSchema),
  market: z.array(FbMarketTargetSchema),
});

export const StatusSchema = z.enum(['new', 'favorite', 'dismissed', 'contacted']);
export const RunBodySchema = z.object({
  channels: z.array(z.enum(['email', 'subito', 'immobiliare', 'idealista', 'facebook'])).min(1),
});

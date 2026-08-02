import { z } from 'zod';
import { isKnownCity } from '../config/cities.js';

/** Schemi di validazione per la config editabile dalla UI (PUT /api/config/*). */

/**
 * Una città dell'elenco. Prima era `z.enum(['torino','bari'])`: giusto sui valori, ma da
 * aggiornare a mano a ogni città aggiunta. Ora la verità sta in un posto solo.
 */
export const CitySchema = z
  .string()
  .min(1)
  .refine(isKnownCity, { error: 'città non riconosciuta: scegline una dall\'elenco' });

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

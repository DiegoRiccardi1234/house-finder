import type { EmailSource } from '../../core/types.js';
import { immobiliareEmail } from './immobiliare-email.js';
import { idealistaEmail } from './idealista-email.js';

// Parser email attivi. Subito/Casa via mail: fase successiva (stesso pattern).
export const emailSources: EmailSource[] = [immobiliareEmail, idealistaEmail];

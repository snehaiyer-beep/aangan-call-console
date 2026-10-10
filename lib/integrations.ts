import "server-only";
import { hubspotConfigured } from "./hubspot";
import type { IntegrationStatus } from "./types";
import { vaaniConfig } from "./vaani";

export function integrationStatus(): IntegrationStatus {
  return { hubspot: { connected: hubspotConfigured() }, vaani: vaaniConfig() };
}

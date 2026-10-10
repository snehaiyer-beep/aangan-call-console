import type { Designer } from "./types";

/**
 * Studio designer roster (14).
 * Pooja Kulkarni, Amit Shinde, Tanvi Joshi — named by the studio.
 * Aryan — appears in the Sept 2026 enquiries (T09); surname not on record.
 * The remaining ten are PLACEHOLDERS — replace with the real team.
 */
export const DESIGNERS: Designer[] = [
  { id: "d01", name: "Pooja Kulkarni", specialty: "Full-home · New builds" },
  { id: "d02", name: "Amit Shinde", specialty: "Compact homes · 2BHK" },
  { id: "d03", name: "Tanvi Joshi", specialty: "Renovations" },
  { id: "d04", name: "Aryan", specialty: "Residential projects" },
  { id: "d05", name: "Rhea Gokhale", specialty: "Wardrobes & joinery" },
  { id: "d06", name: "Siddharth Pawar", specialty: "Villas & independent homes" },
  { id: "d07", name: "Ananya Deshmukh", specialty: "Kitchens" },
  { id: "d08", name: "Kunal Bapat", specialty: "Lighting & ceilings" },
  { id: "d09", name: "Mrunal Sathe", specialty: "Warm minimal · Japandi" },
  { id: "d10", name: "Varun Kale", specialty: "Offices & clinics" },
  { id: "d11", name: "Isha Rane", specialty: "Kids' rooms & study" },
  { id: "d12", name: "Nikita Apte", specialty: "Premium full-home" },
  { id: "d13", name: "Omkar Jadhav", specialty: "Execution coordination" },
  { id: "d14", name: "Shruti Phadke", specialty: "Living & dining" },
];

export function designerById(id: string | null | undefined): Designer | undefined {
  return DESIGNERS.find((d) => d.id === id);
}

/** Tipos da API, todos derivados do schema gerado (nunca escritos à mão). */
import type { components } from "./schema";

type S = components["schemas"];
export type EventSummary = S["EventSummary"];
export type EventOut = S["EventOut"];
export type EventIn = S["EventIn"];
export type CoverPhoto = S["CoverPhoto"];
export type SheetPhoto = S["SheetPhoto"];
export type PhotoOut = S["PhotoOut"];
export type UploadResult = S["UploadResult"];
export type StatsOut = S["StatsOut"];
export type ProgressOut = S["ProgressOut"];
export type SearchOut = S["SearchOut"];
export type FaceHit = S["FaceHit"];
export type DebugHit = S["DebugHit"];
export type SelfieInfo = S["SelfieInfo"];
export type AdminSession = S["AdminSession"];
export type FeatureInfo = S["FeatureInfo"];

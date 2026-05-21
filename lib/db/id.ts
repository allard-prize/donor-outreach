import { createId as cuid2 } from "@paralleldrive/cuid2";

export const createId = (): string => cuid2();

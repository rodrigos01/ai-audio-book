import type { ParamsDictionary } from "express-serve-static-core";
import { HttpError } from "./HttpError";

export function requireParam(params: ParamsDictionary, name: string): string {
  const value = params[name];
  if (typeof value !== "string") {
    throw HttpError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}

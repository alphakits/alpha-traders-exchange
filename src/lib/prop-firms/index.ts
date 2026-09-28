import { topstep } from "./topstep";
import { mffu } from "./mffu";
import { apex } from "./apex";
import { ftmo } from "./ftmo";
import { fundingpips } from "./fundingpips";
export const propFirms = [topstep,mffu,apex,ftmo,fundingpips];
export function getPropFirm(slug:string) { return propFirms.find(firm=>firm.slug===slug); }
export * from "./types";

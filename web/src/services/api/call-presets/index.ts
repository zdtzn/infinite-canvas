import { anthropicScripts } from "./anthropic";
import { agnesScripts } from "./agnes";
import { klingScripts } from "./kling";
import { hailuoScripts } from "./hailuo";
import { wanScripts } from "./wan";
import { viduScripts } from "./vidu";
import { xaiScripts } from "./xai";
import { grok2apiScripts } from "./grok2api";

export const CALL_PRESETS = [...anthropicScripts, ...agnesScripts, ...klingScripts, ...hailuoScripts, ...wanScripts, ...viduScripts, ...xaiScripts, ...grok2apiScripts];

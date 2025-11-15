import type { Protocol } from "./index";
// Example: "ST,GS, 00254.80 kg" ⇒ 254.8
export const mettlerToledo: Protocol = {
    parse(frame) {
        const m = frame.match(/([+-]?\d{1,6}\.\d{1,2})\s*kg/i);
        return m ? parseFloat(m[1]) : null;
    }
};
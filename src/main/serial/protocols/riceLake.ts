import type { Protocol } from "./index";
// Example simple numeric stream: "*00254.80" ⇒ 254.8
export const riceLake: Protocol = {
    parse(frame) {
        const cleaned = frame.replace(/[^0-9.\-]/g, "");
        const v = parseFloat(cleaned);
        return isFinite(v) ? v : null;
    }
};
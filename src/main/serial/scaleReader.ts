import { SerialPort } from "serialport";
import { BrowserWindow, ipcMain } from "electron";
import { WeightStabilizer } from "../util/weightStabilizer";
import { mettlerToledo, riceLake } from "./protocols";


let port: SerialPort | null = null;
let win: BrowserWindow | null = null;


export const listPorts = async () => SerialPort.list();


export const openScale = async (cfg: { path: string; baudRate: number; parity?: "none" | "even" | "odd"; dataBits?: 7 | 8; stopBits?: 1 | 2; protocol?: "mettler" | "ricelake" }) => {
    const proto = cfg.protocol === "mettler" ? mettlerToledo : riceLake;
    const stabilizer = new WeightStabilizer();
    port = new SerialPort({ path: cfg.path, baudRate: cfg.baudRate ?? 9600, dataBits: cfg.dataBits ?? 7, stopBits: cfg.stopBits ?? 1, parity: cfg.parity ?? "even" });
    win = BrowserWindow.getAllWindows()[0] ?? null;
    let buf = "";
    port.on("data", (chunk: Buffer) => {
        buf += chunk.toString("ascii");
        let idx;
        while ((idx = buf.indexOf("\r")) >= 0) {
            const frame = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            const kg = proto.parse(frame);
            if (kg != null) {
                stabilizer.push(kg);
                win?.webContents.send("scale:weight", { kg, raw: frame, stable: stabilizer.isStable() });
            }
        }
    });
    port.on("error", (e) => console.error("Serial error", e));
};


export const closeScale = () => new Promise<void>((resolve) => { if (port) port.close(() => resolve()); else resolve(); });
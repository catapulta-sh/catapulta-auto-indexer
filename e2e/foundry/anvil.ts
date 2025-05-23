import { spawn, ChildProcessWithoutNullStreams } from "child_process";

let anvilProcess: ChildProcessWithoutNullStreams | null = null;

export function startAnvil(port: number = 8545): Promise<void> {
  return new Promise((resolve, reject) => {
    anvilProcess = spawn("anvil", ["-p", port.toString()]);

    anvilProcess.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Listening on")) {
        resolve();
      }
    });

    anvilProcess.stderr.on("data", (data) => {
      console.error("Anvil error:", data.toString());
    });

    anvilProcess.on("close", (code: number) => {
      console.log("Anvil stopped with code", code);
    });

    // Seguridad: falla si tarda más de 5s
    setTimeout(() => {
      if (!anvilProcess) {
        reject(new Error("Anvil failed to start"));
      }
    }, 5000);
  });
}

export function stopAnvil() {
  if (anvilProcess) {
    anvilProcess.kill();
    anvilProcess = null;
  }
}

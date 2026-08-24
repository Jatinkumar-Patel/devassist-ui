import { exec } from 'child_process';

export function execPowerShell(script: string): Promise<string> {
  // Collapse whitespace/newlines into a single -Command string
  const cmd = script.trim().replace(/\r?\n\s*/g, '; ');
  return new Promise((resolve, reject) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '\\"')}"`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 300_000 }, // 50MB buffer, 5-min timeout
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      }
    );
  });
}

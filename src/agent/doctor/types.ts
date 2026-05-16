export type Status = "PASS" | "WARN" | "FAIL";

export interface Check {
  name: string;
  status: Status;
  detail: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

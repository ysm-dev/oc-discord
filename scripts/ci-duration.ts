import { YAML } from "bun";

// oxlint-disable-next-line typescript/no-restricted-types -- trust boundary: validates a job from parsed workflow YAML
const verifyJob = (job: unknown): readonly string[] => {
  if (
    typeof job !== "object" ||
    job === null ||
    !("timeout-minutes" in job) ||
    typeof job["timeout-minutes"] !== "number" ||
    !Number.isInteger(job["timeout-minutes"]) ||
    job["timeout-minutes"] < 1 ||
    job["timeout-minutes"] > 5
  ) {
    return ["CI duration: every job needs an integer timeout-minutes between 1 and 5"];
  }
  return "needs" in job ? ["CI duration: jobs must run independently (needs is forbidden)"] : [];
};

export const verifyCiDuration = (source: string): readonly string[] => {
  const workflow = YAML.parse(source);
  if (
    typeof workflow !== "object" ||
    workflow === null ||
    !("jobs" in workflow) ||
    typeof workflow.jobs !== "object" ||
    workflow.jobs === null ||
    Array.isArray(workflow.jobs) ||
    Object.keys(workflow.jobs).length === 0
  ) {
    return ["CI duration: workflow must contain jobs"];
  }
  return Object.values(workflow.jobs).flatMap(verifyJob);
};

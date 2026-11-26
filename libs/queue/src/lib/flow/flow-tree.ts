// No imports from this library, so the spec can run this file on Node's type stripping.
import type { FlowJob, FlowJobNode } from 'bullmq';

/**
 * Gives every job in the flow that doesn't set its own `jobId` the idempotency key as its ID.
 * Every ID has to be fixed: with only the parent's, adding the flow again attaches second children.
 *
 * @throws if two jobs would share an ID in one queue, which would make them one job in Redis.
 */
export function withIdempotencyKey(
  flow: FlowJob,
  idempotencyKey: string | undefined,
  /** The flow producer's prefix, which BullMQ uses for jobs that don't set their own. */
  defaultPrefix: string,
): FlowJob {
  const opts = { ...flow.opts, jobId: flow.opts?.jobId ?? idempotencyKey };
  const result: FlowJob = flow.children
    ? {
        ...flow,
        opts,
        children: flow.children.map((child) =>
          withJobId(child, idempotencyKey),
        ),
      }
    : { ...flow, opts };
  assertUniqueJobIds(result, defaultPrefix);
  return result;
}

function withJobId(node: FlowJobNode, jobId: string | undefined): FlowJobNode {
  const opts = { ...node.opts, jobId: node.opts?.jobId ?? jobId };
  return node.children
    ? {
        ...node,
        opts,
        children: node.children.map((child) => withJobId(child, jobId)),
      }
    : { ...node, opts };
}

function assertUniqueJobIds(flow: FlowJob, defaultPrefix: string) {
  const seen = new Set<string>();
  const visit = (node: FlowJob | FlowJobNode) => {
    const id = node.opts?.jobId;
    if (id !== undefined) {
      // `||` like BullMQ's FlowProducer, so an empty prefix also means the default.
      const key = `${node.prefix || defaultPrefix}:${node.queueName}:${id}`;
      if (seen.has(key)) {
        throw new Error(
          `The flow has two jobs with ID ${id} in queue ${node.queueName}; give one its own jobId`,
        );
      }
      seen.add(key);
    }
    node.children?.forEach(visit);
  };
  visit(flow);
}

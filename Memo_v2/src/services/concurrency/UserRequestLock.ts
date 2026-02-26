/**
 * Per-user request lock: only one in-flight request per user at a time.
 * Used by the webhook to reject concurrent messages from the same user
 * with an immediate "busy" reply; different users are not blocked.
 */

const busyUsers = new Set<string>();

export type RunExclusiveResult<T> =
	| { status: "accepted"; result: T }
	| { status: "rejected"; reason: "busy" };

/**
 * Run at most one async operation per user at a time.
 * If the user already has a request in progress, returns immediately with status "rejected".
 * Lock is always released in finally, including on thrown errors.
 */
export async function runExclusive<T>(
	userPhone: string,
	fn: () => Promise<T>,
): Promise<RunExclusiveResult<T>> {
	if (busyUsers.has(userPhone)) {
		return { status: "rejected", reason: "busy" };
	}
	busyUsers.add(userPhone);
	try {
		const result = await fn();
		return { status: "accepted", result };
	} finally {
		busyUsers.delete(userPhone);
	}
}

export type LogContext = Record<string, unknown>;

export type Logger = {
	info: (message: string, context?: LogContext) => void;
	warn: (message: string, context?: LogContext) => void;
	error: (message: string, context?: LogContext) => void;
	debug: (message: string, context?: LogContext) => void;
	child: (context: LogContext) => Logger;
};

export function createLogger(baseContext: LogContext = {}): Logger {
	function emit(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: LogContext) {
		const payload = {
			level,
			message,
			timestamp: new Date().toISOString(),
			...baseContext,
			...(context ?? {}),
		};

		const line = JSON.stringify(payload);
		if (level === 'error') {
			console.error(line);
			return;
		}
		if (level === 'warn') {
			console.warn(line);
			return;
		}
		console.log(line);
	}

	return {
		info: (message, context) => emit('info', message, context),
		warn: (message, context) => emit('warn', message, context),
		error: (message, context) => emit('error', message, context),
		debug: (message, context) => emit('debug', message, context),
		child: (context) => createLogger({ ...baseContext, ...context }),
	};
}

export function readNumber(value: string | undefined, defaultValue: number, name: string): number {
	if (value == null || value === '') {
		return defaultValue;
	}

	const number = Number(value);
	if (!Number.isFinite(number)) {
		throw new Error(`Invalid ${name}: expected a number, got ${JSON.stringify(value)}.`);
	}

	return number;
}

export function readBoolean(value: string | undefined, defaultValue: boolean, name: string): boolean {
	if (value == null || value === '') {
		return defaultValue;
	}

	const normalized = value.toLowerCase();
	if (normalized === '1' || normalized === 'true') {
		return true;
	}

	if (normalized === '0' || normalized === 'false') {
		return false;
	}

	throw new Error(`Invalid ${name}: expected true, false, 1, or 0, got ${JSON.stringify(value)}.`);
}

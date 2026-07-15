export class SseParser {
	private buffer = '';
	private dataLines: string[] = [];

	push(chunk: string): string[] {
		this.buffer += chunk.replace(/\r\n/g, '\n');
		const events: string[] = [];
		let newlineIndex = this.buffer.indexOf('\n');
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line === '') this.dispatch(events);
			else if (!line.startsWith(':') && line.startsWith('data:')) this.dataLines.push(line.slice(5).replace(/^ /, ''));
			newlineIndex = this.buffer.indexOf('\n');
		}
		return events;
	}

	finish(): string[] {
		const events: string[] = [];
		if (this.buffer.startsWith('data:')) this.dataLines.push(this.buffer.slice(5).replace(/^ /, ''));
		this.buffer = '';
		this.dispatch(events);
		return events;
	}

	private dispatch(events: string[]): void {
		if (this.dataLines.length === 0) return;
		events.push(this.dataLines.join('\n'));
		this.dataLines = [];
	}
}

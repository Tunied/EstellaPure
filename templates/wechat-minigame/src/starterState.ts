export interface StarterServices {
    login(): Promise<string>; exchange(code: string): Promise<boolean>;
    share(): boolean; reward(): Promise<{ completed: boolean }>;
    getSave(): string | undefined; setSave(value: string): void;
}
/** Account identity, share completion and cloud saving cannot be inferred from host requests. */
export class StarterState {
    credits = 0; message = 'Select three ships to assemble your fleet.'; busy = false;
    private writable = false; private snapshot: string | undefined;
    constructor(private readonly services: StarterServices) {
        try {
            const raw = services.getSave(), value = raw === undefined ? { version: 1, credits: 0 } : JSON.parse(raw);
            if (!value || value.version !== 1 || !Number.isSafeInteger(value.credits) || value.credits < 0
                || Object.keys(value).some(key => key !== 'version' && key !== 'credits')) throw Error('Invalid save');
            this.credits = value.credits; this.snapshot = raw; this.writable = true;
        } catch { this.message = 'Save unreadable; existing progress preserved.'; }
    }
    async login(): Promise<void> {
        if (this.busy) return; this.busy = true; this.message = 'Requesting login...';
        try {
            const code = await this.services.login(); if (!code) throw Error('Missing code');
            this.message = (await this.services.exchange(code)) === true ? 'Your server authenticated the session.' : 'Login code received; connect your server to authenticate.';
        } catch { this.message = 'Login or server exchange failed. Try again.'; }
        finally { this.busy = false; }
    }
    share(): void {
        if (this.busy) return;
        try { this.message = this.services.share() ? 'Share requested; completion cannot be confirmed.' : 'Sharing is unavailable here.'; }
        catch { this.message = 'Share request failed.'; }
    }
    async reward(): Promise<void> {
        if (this.busy) return; this.busy = true; this.message = 'Waiting for the rewarded video...';
        try {
            if ((await this.services.reward()).completed !== true) { this.message = 'Video incomplete; no credit granted.'; return; }
            if (!Number.isSafeInteger(this.credits + 1)) throw Error('Credit limit');
            this.credits++; this.message = 'Credit earned for this session.';
            if (!this.writable) return;
            try {
                if (this.services.getSave() !== this.snapshot) { this.writable = false; this.message = 'Saved progress changed; reload before saving.'; return; }
                const raw = JSON.stringify({ version: 1, credits: this.credits });
                this.services.setSave(raw); this.snapshot = raw; this.message = 'Credit saved on this device.';
            } catch { this.message = 'Credit earned; device save failed.'; }
        } catch { this.message = 'Rewarded video failed; no credit granted.'; }
        finally { this.busy = false; }
    }
}

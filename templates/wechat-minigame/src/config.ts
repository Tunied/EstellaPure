/** Your own WeChat rewarded-video unit. Empty disables the button. */
export const REWARDED_AD_UNIT_ID = '';
export const SHARE_TITLE = 'Assemble your space fleet!';
/** Exchange on your server. Never ship an AppSecret, log codes or treat a code as identity. */
export async function exchangeLoginCode(_code: string): Promise<boolean> { return false; }

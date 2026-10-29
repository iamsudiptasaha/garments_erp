export function normalisePhone(value){const digits=String(value||'').replace(/[\s()-]/g,'');if(!/^[6-9]\d{9}$/.test(digits))throw Error('Enter a valid 10-digit mobile number.');return '+91'+digits}
export function normaliseEmployeeCode(value){const input=String(value||'').trim().toUpperCase();const digits=input.startsWith('SCE/')?input.slice(4):input;if(!/^\d{5}$/.test(digits))throw Error('Enter the five digits of the employee code.');return 'SCE/'+digits}

export function assertAccountLinkAvailable(accounts,draft){
 if(accounts.some(a=>a.employee_id===draft.employee_id&&a.user_id!==draft.user_id))throw Error('This employee already has a login account. Open their existing account and choose Edit access.');
 if(!draft.version&&accounts.some(a=>a.user_id===draft.user_id))throw Error('This login account is already linked. Open its existing entry and choose Edit access.');
}
export function accountAccessError(error){
 if(error.code==='23505'&&String(error.message).includes('app_user_employee_id_key'))return 'This employee was already linked to a login account. Refresh access, then edit their existing account. Each employee can have one login account.';
 return error.message;
}

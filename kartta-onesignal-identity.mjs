/** Serializes OneSignal identity changes so sign-out/account-switch races cannot cross-link users. */
export function createOneSignalIdentitySynchronizer(getOneSignal) {
  let currentExternalId = null;
  let queue = Promise.resolve();

  return function syncIdentity(userId) {
    queue = queue.then(async () => {
      const OneSignal = await getOneSignal();
      if (!userId) {
        // The SDK may have restored an External ID from a previous page load.
        if (currentExternalId || OneSignal.User.externalId) await OneSignal.logout();
        currentExternalId = null;
        return;
      }
      if (currentExternalId === userId && OneSignal.User.externalId === userId) return;
      // login() switches an existing OneSignal user to the new Supabase UUID.
      await OneSignal.login(userId);
      currentExternalId = userId;
    }).catch(() => {
      // A later auth event can safely retry; never log IDs, tokens, or credentials.
      currentExternalId = null;
    });
    return queue;
  };
}

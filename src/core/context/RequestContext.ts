import { AsyncLocalStorage } from 'async_hooks';
import { RequestUserContext } from '../../types/UserContext';

const storage = new AsyncLocalStorage<RequestUserContext>();

export const RequestContext = {
  run<T>(context: RequestUserContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestUserContext | undefined {
    return storage.getStore();
  }
};


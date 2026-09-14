import { QueryClient } from '@tanstack/react-query';

// IPC calls are local and cheap; retries only hide bugs, and data is refreshed by events.
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

export const queryClient = createQueryClient();

'use client';

import { RouteError } from '@postmill-ai/frontend/components/errors/route-error';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function BuildLogError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <RouteError
      {...props}
      title={t('build_log_error_title', 'The build log hit a snag')}
    />
  );
}

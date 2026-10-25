'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { Textarea } from '@postmill-ai/react/form/textarea';
import { Checkbox } from '@postmill-ai/react/form/checkbox';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { deleteDialog } from '@postmill-ai/react/helpers/delete.dialog';
import { UtcToLocalDateRender } from '@postmill-ai/react/helpers/utc.date.render';
import SafeImage from '@postmill-ai/react/helpers/safe.image';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { LoadingRows } from '@postmill-ai/frontend/components/ui/loading-rows';

interface Source {
  id: string;
  repo: string;
  hasToken: boolean;
  lastSyncedAt: string | null;
}

interface Activity {
  id: string;
  kind: 'commit' | 'pull_request' | 'release' | 'changelog' | 'note';
  title: string;
  url: string | null;
  occurredAt: string;
  usedAt: string | null;
}

interface Channel {
  id: string;
  name: string;
  picture: string;
  identifier: string;
}

const card = 'bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] flex flex-col gap-[16px]';
// Same section-title treatment as dashboard SectionCard.
const heading = 'text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText';

// Throws the API's message so callers can toast it.
const json = async (res: Response) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(Array.isArray(body?.message) ? body.message.join(', ') : body?.message || `Request failed (${res.status})`);
  }
  return body;
};

const useSources = () => {
  const fetch = useFetch();
  const load = useCallback(async () => json(await fetch('/build-log/sources')), [fetch]);
  return useSWR<Source[]>('build-log-sources', load);
};

const useActivities = () => {
  const fetch = useFetch();
  const load = useCallback(async () => json(await fetch('/build-log/activities')), [fetch]);
  return useSWR<Activity[]>('build-log-activities', load);
};

const useChannels = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const [supported, list] = await Promise.all([
      fetch('/build-log/channels').then(json),
      fetch('/integrations/list').then(json),
    ]);
    return (list.integrations as any[]).filter(
      (i) => supported.includes(i.identifier) && !i.disabled
    ) as Channel[];
  }, [fetch]);
  return useSWR<Channel[]>('build-log-channels', load);
};

// A list row that toggles selection by click, Space or Enter.
const SelectRow: FC<{
  checked: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}> = ({ checked, onToggle, className, children }) => (
  <li>
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={clsx(
        'flex gap-[12px] min-h-[44px] rounded-[8px] cursor-pointer hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
        className
      )}
    >
      <Checkbox
        disableForm
        checked={checked}
        variant={checked ? 'default' : 'hollow'}
        className="shrink-0"
      />
      {children}
    </div>
  </li>
);

const KindBadge: FC<{ kind: Activity['kind'] }> = ({ kind }) => {
  const t = useT();
  const labels: Record<Activity['kind'], string> = {
    commit: t('build_log_kind_commit', 'Commit'),
    pull_request: t('build_log_kind_pr', 'PR'),
    release: t('build_log_kind_release', 'Release'),
    changelog: t('build_log_kind_changelog', 'Changelog'),
    note: t('build_log_kind_note', 'Note'),
  };
  return (
    <span className="shrink-0 text-[11px] font-[600] uppercase tracking-[0.04em] text-newTableText border border-newTableBorder rounded-[6px] px-[6px] py-[2px]">
      {labels[kind]}
    </span>
  );
};

const Sources: FC<{ onSync: () => void }> = ({ onSync }) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const { data, mutate } = useSources();
  const form = useForm({ values: { repo: '', token: '' } });
  const [saving, setSaving] = useState(false);

  const add = useCallback(
    async (values: { repo: string; token: string }) => {
      setSaving(true);
      try {
        await json(
          await fetch('/build-log/sources', {
            method: 'POST',
            body: JSON.stringify({ repo: values.repo.trim(), ...(values.token ? { token: values.token } : {}) }),
          })
        );
        form.reset();
        await mutate();
        toast.show(t('build_log_repo_added', 'Repo added — syncing now'), 'success');
        onSync();
      } catch (e) {
        toast.show((e as Error).message, 'warning');
      } finally {
        setSaving(false);
      }
    },
    [fetch, form, mutate, onSync, toast, t]
  );

  const remove = useCallback(
    async (source: Source) => {
      if (!(await deleteDialog(t('build_log_remove_repo', 'Stop tracking {{repo}}? Activity already collected stays.', { repo: source.repo })))) return;
      try {
        await json(await fetch(`/build-log/sources/${source.id}`, { method: 'DELETE' }));
        mutate();
      } catch (e) {
        toast.show((e as Error).message, 'warning');
      }
    },
    [fetch, mutate, toast, t]
  );

  return (
    <section className={card}>
      <h2 className={heading}>{t('build_log_sources', 'GitHub repos')}</h2>
      {data?.length ? (
        <ul className="flex flex-col gap-[8px]">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-[8px] min-h-[44px]">
              <div className="min-w-0">
                <div className="text-[14px] text-textColor truncate">{s.repo}</div>
                <div className="text-[12px] text-newTableText">
                  {s.lastSyncedAt ? (
                    <>
                      {t('build_log_synced', 'Synced')} <UtcToLocalDateRender date={s.lastSyncedAt} format="D MMM YYYY, HH:mm" />
                    </>
                  ) : (
                    t('build_log_never_synced', 'Not synced yet')
                  )}
                  {s.hasToken ? ` · ${t('build_log_token_saved', 'token saved')}` : ''}
                </div>
              </div>
              <Button secondary className="shrink-0 h-[36px]" onClick={() => remove(s)}>
                {t('remove', 'Remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-newTableText">
          {t('build_log_no_repos', 'Add a repo to pull in commits, merged PRs, releases and CHANGELOG.md.')}
        </p>
      )}
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(add)} className="flex flex-col gap-[12px]">
          {/* text + password reads as a login form to Chrome, which then fills
              the saved email/password here; "off" alone is ignored for passwords. */}
          <Input
            label={t('build_log_repo', 'Repository')}
            name="repo"
            placeholder="owner/name"
            autoComplete="off"
          />
          <Input
            label={t('build_log_token', 'Token (private repos only)')}
            name="token"
            type="password"
            autoComplete="new-password"
            placeholder="github_pat_…"
          />
          <Button type="submit" loading={saving}>
            {t('build_log_add_repo', 'Add repo')}
          </Button>
        </form>
      </FormProvider>
    </section>
  );
};

const Note: FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const form = useForm({ values: { text: '' } });
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async ({ text }: { text: string }) => {
      setSaving(true);
      try {
        await json(await fetch('/build-log/notes', { method: 'POST', body: JSON.stringify({ text }) }));
        form.reset();
        onSaved();
      } catch (e) {
        toast.show((e as Error).message, 'warning');
      } finally {
        setSaving(false);
      }
    },
    [fetch, form, onSaved, toast]
  );

  return (
    <section className={card}>
      <h2 className={heading}>{t('build_log_daily_note', 'Daily note')}</h2>
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-[12px]">
          <Textarea
            label={t('build_log_note_label', 'What did you learn or decide today?')}
            name="text"
            placeholder={t('build_log_note_placeholder', 'Spent 3 hours on a login race. The fix was…')}
          />
          <Button type="submit" secondary loading={saving}>
            {t('build_log_save_note', 'Save note')}
          </Button>
        </form>
      </FormProvider>
    </section>
  );
};

export const BuildLog: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const router = useRouter();
  const activities = useActivities();
  const sources = useSources();
  const channels = useChannels();
  const [selected, setSelected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const { added, errors } = await json(await fetch('/build-log/sync', { method: 'POST' }));
      if (errors?.length) {
        toast.show(errors.map((e: { message: string }) => e.message).join(' '), 'warning');
      } else {
        toast.show(t('build_log_synced_count', '{{count}} new items', { count: added }), 'success');
      }
      activities.mutate();
      sources.mutate();
    } catch (e) {
      toast.show((e as Error).message, 'warning');
    } finally {
      setSyncing(false);
    }
  }, [fetch, toast, t, activities, sources]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const { drafts } = await json(
        await fetch('/build-log/generate', {
          method: 'POST',
          body: JSON.stringify({ activityIds: selected, integrationIds: picked }),
        })
      );
      toast.show(t('build_log_drafts_created', '{{count}} drafts added to your calendar', { count: drafts }), 'success');
      setSelected([]);
      activities.mutate();
    } catch (e) {
      toast.show((e as Error).message, 'warning');
    } finally {
      setGenerating(false);
    }
  }, [fetch, selected, picked, toast, t, activities]);

  const unused = (activities.data || []).filter((a) => !a.usedAt);

  return (
    <div className="flex-1 flex flex-col p-[24px] mobile:p-[16px] gap-[24px]">
      {/* The top bar already shows the page title (campaigns pattern). */}
      <div className="flex items-center justify-between gap-[16px] mobile:flex-col mobile:items-stretch">
        <p className="text-[13px] text-newTableText max-w-[720px]">
          {t(
            'build_log_subtitle',
            'Your commits, PRs, releases and notes, turned into drafts for LinkedIn, X, Reddit and Instagram. Nothing posts until you schedule it.'
          )}
        </p>
        <Button className="shrink-0" onClick={sync} loading={syncing}>
          {t('build_log_sync', 'Sync GitHub')}
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] mobile:grid-cols-1 gap-[20px] items-start">
        <section className={card}>
          <div className="flex items-center justify-between gap-[8px]">
            <h2 className={heading}>
              {t('build_log_activity', 'Activity')}
              {!!selected.length && (
                <span className="ms-[8px] text-[13px] font-[400] text-newTableText">
                  {t('build_log_selected', '{{count}} selected', { count: selected.length })}
                </span>
              )}
            </h2>
            {!!unused.length && (
              <Button secondary className="h-[36px]" onClick={() => setSelected(unused.slice(0, 10).map((a) => a.id))}>
                {t('build_log_select_unused', 'Select newest unused')}
              </Button>
            )}
          </div>
          {activities.isLoading ? (
            <LoadingRows rows={6} columns={1} />
          ) : activities.error ? (
            <p className="text-[13px] text-dangerText">{(activities.error as Error).message}</p>
          ) : !activities.data?.length ? (
            <EmptyState
              title={t('build_log_empty', 'No build activity yet')}
              description={t('build_log_empty_desc', 'Add a GitHub repo and sync, or write a daily note. Each item becomes raw material for a post.')}
            />
          ) : (
            <ul className="flex flex-col max-h-[640px] overflow-y-auto -mx-[8px]">
              {activities.data.map((a) => (
                <SelectRow
                  key={a.id}
                  checked={selected.includes(a.id)}
                  onToggle={() => setSelected((s) => toggle(s, a.id))}
                  className={clsx('items-start px-[8px] py-[10px]', a.usedAt && 'opacity-60')}
                >
                  <div className="min-w-0 flex-1 flex flex-col gap-[4px]">
                    <div className="flex items-start gap-[8px] min-w-0">
                      <KindBadge kind={a.kind} />
                      <span className="text-[14px] text-textColor line-clamp-2 break-words">{a.title}</span>
                    </div>
                    <div className="text-[12px] text-newTableText">
                      <UtcToLocalDateRender date={a.occurredAt} format="D MMM YYYY" />
                      {a.usedAt ? ` · ${t('build_log_used', 'used in a draft')}` : ''}
                      {a.url && (
                        <>
                          {' · '}
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-textColor"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t('build_log_view', 'view')}
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </SelectRow>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-[20px]">
          <section className={card}>
            <h2 className={heading}>{t('build_log_generate', 'Generate drafts')}</h2>
            {channels.isLoading ? (
              <LoadingRows rows={2} columns={1} />
            ) : !channels.data?.length ? (
              <p className="text-[13px] text-newTableText">
                {t('build_log_no_channels', 'Connect a LinkedIn, X, Reddit or Instagram channel to generate drafts.')}
              </p>
            ) : (
              <ul className="flex flex-col">
                {channels.data.map((c) => (
                  <SelectRow
                    key={c.id}
                    checked={picked.includes(c.id)}
                    onToggle={() => setPicked((p) => toggle(p, c.id))}
                    className="items-center px-[4px]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- external channel avatar */}
                    <img src={c.picture || '/no-picture.jpg'} alt="" className="w-[28px] h-[28px] rounded-full shrink-0" />
                    <span className="text-[14px] text-textColor truncate flex-1">{c.name}</span>
                    <SafeImage
                      src={`/icons/platforms/${c.identifier}.png`}
                      alt={c.identifier}
                      width={16}
                      height={16}
                      className="shrink-0"
                    />
                  </SelectRow>
                ))}
              </ul>
            )}
            <Button
              onClick={generate}
              loading={generating}
              disabled={!selected.length || !picked.length}
            >
              {selected.length && picked.length
                ? t('build_log_generate_cta', 'Generate drafts')
                : t('build_log_generate_hint', 'Select activity and channels')}
            </Button>
            <p className="text-[12px] text-newTableText">
              {t(
                'build_log_generate_note',
                "Drafts use your org's AI provider and brand voice, and only facts from the selected items. Gaps are marked [TODO] for you to fill. For Reddit, check the subreddit's rules and pick a flair in the composer if it needs one."
              )}
            </p>
            <Button secondary onClick={() => router.push('/posts')}>
              {t('build_log_open_calendar', 'Open calendar')}
            </Button>
          </section>
          <Sources onSync={sync} />
          <Note onSaved={() => activities.mutate()} />
        </div>
      </div>
    </div>
  );
};

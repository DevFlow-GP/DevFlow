import { useEffect, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Icon from '../ui/Icon';
import { ROUTES } from '../../config/navigation';
import { api } from '../../services/api';
import { formatRelative } from '../../utils/formatDate';

const PAGE_SIZE = 30;

/** The connected account's repositories, newest activity first, with "Load more". */
export default function GitHubRepoList() {
  const [repos, setRepos] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listGitHubRepos({ page, perPage: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setRepos((current) => (page === 1 ? result.repositories : [...current, ...result.repositories]));
        setHasNext(result.has_next);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? repos.filter((repo) => repo.full_name.toLowerCase().includes(needle)) : repos;

  return (
    <Card padding="none" className="repo-list">
      <div className="repo-list__head">
        <h2 className="github-panel__title">Your repositories</h2>
        <div className="search-field repo-list__search">
          <Icon name="search" size="base" className="search-field__icon" />
          <input
            id="repo-filter"
            type="text"
            className="input input--search"
            placeholder="Filter loaded repositories…"
            aria-label="Filter repositories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="repo-list__message">
          <Alert tone="error" icon="error" title="Couldn't load your repositories">
            {error}
          </Alert>
        </div>
      )}

      <ul className="repo-list__items">
        {visible.map((repo) => (
          <li key={repo.id} className="repo-list__item">
            <div className="repo-list__info">
              <a className="repo-list__name" href={repo.html_url} target="_blank" rel="noreferrer">
                {repo.full_name}
              </a>
              {repo.description && <p className="repo-list__description">{repo.description}</p>}
              <div className="meta-list">
                <span className={`badge badge--${repo.private ? 'neutral' : 'info'}`}>
                  {repo.private ? 'Private' : 'Public'}
                </span>
                {repo.language && <span>{repo.language}</span>}
                <span>
                  Default branch <strong>{repo.default_branch}</strong>
                </span>
                {repo.updated_at && <span>Updated {formatRelative(repo.updated_at)}</span>}
              </div>
            </div>
            <Button
              size="xs"
              variant="outline"
              icon="add"
              to={`${ROUTES.newProject}?repo=${encodeURIComponent(repo.full_name)}`}
            >
              Create project
            </Button>
          </li>
        ))}
        {!loading && !error && visible.length === 0 && (
          <li className="repo-list__message text-muted">
            {repos.length === 0 ? 'No repositories found on this GitHub account.' : 'No loaded repositories match.'}
          </li>
        )}
      </ul>

      {(loading || hasNext) && (
        <div className="repo-list__footer">
          {loading ? (
            <span className="async-state__inline text-muted">
              <span className="spinner" aria-hidden="true" /> Loading repositories…
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setPage((n) => n + 1)}>
              Load more
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

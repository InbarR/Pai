import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Search, Mail, Phone, MapPin, Briefcase, Users, ArrowLeft, ChevronRight, MessageSquare } from 'lucide-react';

interface Person {
  name: string;
  email: string;
  title: string;
  department: string;
  office: string;
  phone: string;
  manager: string;
  alias: string;
  emailCount?: number;
  lastContact?: string;
}

export default function PeoplePage() {
  const [tab, setTab] = useState<'top' | 'team' | 'search'>('top');
  const [search, setSearch] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  const { data: topPeople = [], isLoading: loadingTop } = useQuery({
    queryKey: ['people-top'],
    queryFn: () => api.get<Person[]>('/people/top'),
  });

  const { data: teamPeople = [], isLoading: loadingTeam } = useQuery({
    queryKey: ['people-team'],
    queryFn: () => api.get<Person[]>('/people/team'),
  });

  const { data: searchResults = [], isLoading: loadingSearch } = useQuery({
    queryKey: ['people-search', search],
    queryFn: () => api.get<Person[]>(`/people/search?q=${encodeURIComponent(search)}`),
    enabled: search.length >= 2,
  });

  const { data: personEmails = [] } = useQuery({
    queryKey: ['person-emails', selectedPerson?.name],
    queryFn: () => api.get<any[]>(`/people/${encodeURIComponent(selectedPerson!.name)}/emails`),
    enabled: !!selectedPerson,
  });

  // Lazy AD enrichment when person is selected
  const { data: enrichedPerson } = useQuery({
    queryKey: ['person-enrich', selectedPerson?.alias || selectedPerson?.name],
    queryFn: () => api.get<Person>(`/people/enrich/${encodeURIComponent(selectedPerson!.alias || selectedPerson!.name)}`),
    enabled: !!selectedPerson,
    staleTime: 60_000,
  });

  const displayPerson = enrichedPerson?.name ? { ...selectedPerson!, ...enrichedPerson } : selectedPerson;

  // Org chart data for selected person
  const personKey = selectedPerson?.alias || selectedPerson?.name || '';
  const { data: directReports = [] } = useQuery({
    queryKey: ['person-reports', personKey],
    queryFn: () => api.get<Person[]>(`/people/reports/${encodeURIComponent(personKey)}`),
    enabled: !!selectedPerson,
    staleTime: 120_000,
  });

  const { data: managerChain = [] } = useQuery({
    queryKey: ['person-chain', personKey],
    queryFn: () => api.get<Person[]>(`/people/chain/${encodeURIComponent(personKey)}`),
    enabled: !!selectedPerson,
    staleTime: 120_000,
  });

  const people = tab === 'top' ? topPeople : tab === 'team' ? teamPeople : searchResults;
  const loading = tab === 'top' ? loadingTop : tab === 'team' ? loadingTeam : loadingSearch;

  // Person detail view
  if (selectedPerson) {
    const p = displayPerson || selectedPerson;
    return (
      <div className="max-w-600">
        <button className="ghost mb-4" onClick={() => setSelectedPerson(null)}>
          <ArrowLeft size={16} /> Back
        </button>

        <div className="person-detail-header">
          <div className="person-avatar-lg">
            {p.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 className="font-semibold" style={{ fontSize: 22 }}>{p.name}</h2>
            {p.title && <div className="text-secondary">{p.title}</div>}
            {p.department && <div className="text-small text-muted">{p.department}</div>}
          </div>
        </div>

        <div className="person-detail-info">
          {p.email && (
            <div className="person-detail-row">
              <Mail size={14} /> <a href={`mailto:${p.email}`}>{p.email}</a>
            </div>
          )}
          {p.phone && (
            <div className="person-detail-row">
              <Phone size={14} /> {p.phone}
            </div>
          )}
          {p.office && (
            <div className="person-detail-row">
              <MapPin size={14} /> {p.office}
            </div>
          )}
          {p.email && (
            <div className="person-detail-row">
              <MessageSquare size={14} /> <a href={`https://teams.microsoft.com/l/chat/0/0?users=${p.email}`} target="_blank" rel="noopener noreferrer">Chat in Teams</a>
            </div>
          )}
        </div>

        {/* Manager Chain (org chart up) */}
        {managerChain.length > 0 && (
          <div className="person-section">
            <h3 className="person-section-title"><Users size={14} /> Reporting Chain</h3>
            <div className="org-chain">
              {[...managerChain].reverse().map((mgr, i) => (
                <div key={i} className="org-chain-item" onClick={() => setSelectedPerson(mgr)}>
                  <div className="org-chain-connector">{i < managerChain.length - 1 && <div className="org-chain-line" />}</div>
                  <div className="person-avatar-sm">{mgr.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="person-chain-name">{mgr.name}</div>
                    <div className="text-xs text-muted">{mgr.title}</div>
                  </div>
                </div>
              ))}
              <div className="org-chain-item current">
                <div className="org-chain-connector" />
                <div className="person-avatar-sm current">{p.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}</div>
                <div>
                  <div className="person-chain-name"><strong>{p.name}</strong></div>
                  <div className="text-xs text-muted">{p.title}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Direct Reports */}
        {directReports.length > 0 && (
          <div className="person-section">
            <h3 className="person-section-title"><Users size={14} /> Direct Reports ({directReports.length})</h3>
            <div className="people-grid compact">
              {directReports.map((report, i) => (
                <div key={i} className="person-card" onClick={() => setSelectedPerson(report)}>
                  <div className="person-avatar">
                    {report.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
                  </div>
                  <div className="person-info">
                    <div className="person-name">{report.name}</div>
                    <div className="person-meta">
                      {report.title ? <><Briefcase size={11} /> {report.title}</> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Emails */}
        {personEmails.length > 0 && (
          <div className="person-section">
            <h3 className="person-section-title"><Mail size={14} /> Recent Emails</h3>
            {personEmails.map((email: any) => (
              <div key={email.id} className="card">
                <div className="flex justify-between">
                  <span style={{ fontWeight: 600, fontSize: 13 }} className="truncate">{email.subject}</span>
                  <span className="text-xs text-muted">{new Date(email.receivedAt).toLocaleDateString()}</span>
                </div>
                <div className="text-xs text-muted mt-1" style={{ maxHeight: 32, overflow: 'hidden' }}>
                  {email.bodyPreview}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2>People</h2>
      </div>

      {/* Search */}
      <div className="notes-search" style={{ marginBottom: 12 }}>
        <Search size={14} className="notes-search-icon" />
        <input
          placeholder="Search for a person..."
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            if (e.target.value.length >= 2) setTab('search');
            else if (e.target.value.length === 0) setTab('top');
          }}
        />
      </div>

      {/* Tabs */}
      <div className="email-filters" style={{ marginBottom: 16 }}>
        <button className={`email-filter ${tab === 'top' ? 'active' : ''}`} onClick={() => { setTab('top'); setSearch(''); }}>
          Top
        </button>
        <button className={`email-filter ${tab === 'team' ? 'active' : ''}`} onClick={() => { setTab('team'); setSearch(''); }}>
          <Users size={12} /> My Team
        </button>
        {search.length >= 2 && (
          <button className={`email-filter ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
            Results ({searchResults.length})
          </button>
        )}
      </div>

      {loading && (
        <div className="page-loading">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      )}

      <div className="people-grid">
        {people.map((person, i) => (
          <div key={`${person.email || person.name}-${i}`} className="person-card" onClick={() => setSelectedPerson(person)}>
            <div className="person-avatar">
              {person.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <div className="person-info">
              <div className="person-name">{person.name}</div>
              <div className="person-meta">
                {person.title ? (
                  <><Briefcase size={11} /> {person.title}</>
                ) : person.emailCount ? (
                  <><Mail size={11} /> {person.emailCount} emails</>
                ) : person.department ? (
                  <span>{person.department}</span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {people.length === 0 && !loading && (
        <div className="empty-inline">
          {tab === 'search' && search.length < 2 ? 'Type at least 2 characters to search' :
           tab === 'search' ? 'No matches found' :
           tab === 'team' ? 'No direct reports found' :
           'Sync emails first to see top contacts'}
        </div>
      )}
    </div>
  );
}

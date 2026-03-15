import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Search, Mail, Phone, MapPin, Briefcase, Users, ArrowLeft } from 'lucide-react';

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

  const people = tab === 'top' ? topPeople : tab === 'team' ? teamPeople : searchResults;
  const loading = tab === 'top' ? loadingTop : tab === 'team' ? loadingTeam : loadingSearch;

  // Person detail view
  if (selectedPerson) {
    return (
      <div>
        <button className="ghost" onClick={() => setSelectedPerson(null)} style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} /> Back
        </button>

        <div className="person-detail-header">
          <div className="person-avatar-lg">
            {(displayPerson || selectedPerson)!.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600 }}>{(displayPerson || selectedPerson)!.name}</h2>
            {displayPerson?.title && <div className="text-secondary">{displayPerson.title}</div>}
            {displayPerson?.department && <div className="text-small text-muted">{displayPerson.department}</div>}
          </div>
        </div>

        <div className="person-detail-info">
          {(displayPerson || selectedPerson)!.email && (
            <div className="person-detail-row">
              <Mail size={14} /> <a href={`mailto:${(displayPerson || selectedPerson)!.email}`}>{(displayPerson || selectedPerson)!.email}</a>
            </div>
          )}
          {displayPerson?.phone && (
            <div className="person-detail-row">
              <Phone size={14} /> {displayPerson.phone}
            </div>
          )}
          {displayPerson?.office && (
            <div className="person-detail-row">
              <MapPin size={14} /> {displayPerson.office}
            </div>
          )}
          {displayPerson?.manager && (
            <div className="person-detail-row">
              <Users size={14} /> Reports to: {displayPerson.manager}
            </div>
          )}
        </div>

        {personEmails.length > 0 && (
          <>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '20px 0 8px' }}>Recent Emails</h3>
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
          </>
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

      {loading && <div className="text-muted">Loading...</div>}

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
        <div className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
          {tab === 'search' && search.length < 2 ? 'Type at least 2 characters to search' :
           tab === 'search' ? 'No matches found' :
           tab === 'team' ? 'No direct reports found' :
           'Sync emails first to see top contacts'}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsApi, connectionsApi } from '../services/api';
import { ArrowLeft, Save, Loader2, Info, HelpCircle, Play, CheckCircle, XCircle, Table } from 'lucide-react';

export default function ReportEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean; message: string; rowCount?: number; columns?: string[]} | null>(null);
  const [connections, setConnections] = useState<any[]>([]);
  
  const [form, setForm] = useState({
    name: '',
    description: '',
    connection_id: 0,
    query: '',
    cache_enabled: true,
    cache_ttl: 3600,
    default_group_by: [] as string[],
    available_metrics: [] as any[],
    column_labels: {} as Record<string, string>
  });
  
  useEffect(() => {
    loadConnections();
    if (!isNew) loadReport();
  }, [id]);
  
  const loadConnections = async () => {
    const data = await connectionsApi.list();
    setConnections(data);
    if (data.length > 0 && !form.connection_id) {
      setForm(f => ({ ...f, connection_id: data[0].id }));
    }
  };
  
  const loadReport = async () => {
    try {
      const data = await reportsApi.get(parseInt(id!));
      setForm({
        name: data.name,
        description: data.description || '',
        connection_id: data.connection_id,
        query: data.query,
        cache_enabled: data.cache_enabled,
        cache_ttl: data.cache_ttl,
        default_group_by: data.default_group_by || [],
        available_metrics: data.available_metrics || [],
        column_labels: data.column_labels || {}
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      if (isNew) {
        const report = await reportsApi.create(form);
        navigate(`/reports/${report.id}`);
      } else {
        await reportsApi.update(parseInt(id!), form);
        navigate(`/reports/${id}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.detail || 'Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };
  
  const handleTestQuery = async () => {
    if (!form.connection_id) {
      alert('Seleziona una connessione');
      return;
    }
    if (!form.query.trim()) {
      alert('Inserisci una query SQL');
      return;
    }
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const response = await fetch('/api/reports/test-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          connection_id: form.connection_id,
          query: form.query
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setTestResult({
          success: true,
          message: `Query eseguita con successo`,
          rowCount: data.row_count,
          columns: data.columns
        });
      } else {
        setTestResult({
          success: false,
          message: data.detail || 'Errore nell\'esecuzione della query'
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Errore di connessione'
      });
    } finally {
      setTesting(false);
    }
  };
  
  // Convert seconds to readable format
  const formatTTL = (seconds: number) => {
    if (seconds < 60) return `${seconds} secondi`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} minuti`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)} ore`;
    return `${Math.round(seconds / 86400)} giorni`;
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">
          {isNew ? 'Nuovo Report' : 'Modifica Report'}
        </h1>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="bg-white rounded-xl p-6 border">
          <h2 className="font-semibold mb-4">Informazioni Base</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome Report *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Es: Vendite Mensili"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Connessione Database *</label>
              <select
                value={form.connection_id}
                onChange={e => setForm({ ...form, connection_id: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">-- Seleziona --</option>
                {connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.db_type})</option>
                ))}
              </select>
              {connections.length === 0 && (
                <p className="text-xs text-orange-500 mt-1">
                  Nessuna connessione disponibile. Creane una prima.
                </p>
              )}
            </div>
          </div>
          
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">Descrizione</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Descrizione opzionale del report"
            />
          </div>
        </div>
        
        {/* Query */}
        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Query SQL</h2>
            <button
              type="button"
              onClick={handleTestQuery}
              disabled={testing || !form.connection_id || !form.query.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg transition text-sm"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Testa Query
            </button>
          </div>
          
          <textarea
            value={form.query}
            onChange={e => {
              setForm({ ...form, query: e.target.value });
              setTestResult(null);
            }}
            className="w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500"
            rows={12}
            placeholder={`-- Esempio per SQL Server:
SELECT 
    YEAR(data_doc) as Anno,
    MONTH(data_doc) as Mese,
    cliente as Cliente,
    agente as Agente,
    SUM(importo) as Venduto,
    SUM(costo) as Costo
FROM vendite
WHERE data_doc >= '2024-01-01'
GROUP BY YEAR(data_doc), MONTH(data_doc), cliente, agente`}
            required
          />
          
          {/* Test Result */}
          {testResult && (
            <div className={`mt-4 p-4 rounded-lg ${
              testResult.success 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className={`flex items-center gap-2 font-medium ${
                testResult.success ? 'text-green-700' : 'text-red-700'
              }`}>
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                {testResult.message}
              </div>
              
              {testResult.success && testResult.rowCount !== undefined && (
                <div className="mt-3 text-sm text-green-600">
                  <div className="flex items-center gap-2 mb-2">
                    <Table className="w-4 h-4" />
                    <strong>{testResult.rowCount.toLocaleString()}</strong> righe trovate
                  </div>
                  {testResult.columns && testResult.columns.length > 0 && (
                    <div>
                      <span className="text-gray-600">Colonne: </span>
                      <span className="font-mono text-xs">
                        {testResult.columns.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <p className="text-xs text-gray-400 mt-3">
            💡 La query viene eseguita con LIMIT 100 durante il test. I calcoli dei margini sui totali verranno gestiti automaticamente dal sistema.
          </p>
        </div>
        
        {/* Cache settings */}
        <div className="bg-white rounded-xl p-6 border">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold">Cache e Performance</h2>
            <div className="group relative">
              <Info className="w-4 h-4 text-gray-400 cursor-help" />
              <div className="absolute left-6 top-0 w-72 p-3 bg-gray-800 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-10">
                <strong>Cache:</strong> I risultati vengono salvati temporaneamente per velocizzare le visualizzazioni successive.
                <br/><br/>
                <strong>TTL:</strong> Tempo di vita della cache prima che i dati vengano ricaricati dal database.
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.cache_enabled}
                onChange={e => setForm({ ...form, cache_enabled: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium">Abilita Cache</span>
                <p className="text-sm text-gray-500">
                  Consigliato per report con molti dati
                </p>
              </div>
            </label>
            
            {form.cache_enabled && (
              <div className="ml-8 p-4 bg-gray-50 rounded-lg">
                <label className="block text-sm font-medium mb-2">
                  Durata Cache: <strong>{formatTTL(form.cache_ttl)}</strong>
                </label>
                <input
                  type="range"
                  min="60"
                  max="86400"
                  step="60"
                  value={form.cache_ttl}
                  onChange={e => setForm({ ...form, cache_ttl: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>1 min</span>
                  <span>1 ora</span>
                  <span>24 ore</span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={saving || connections.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg transition"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isNew ? 'Crea Report' : 'Salva Modifiche'}
          </button>
        </div>
      </form>
    </div>
  );
}

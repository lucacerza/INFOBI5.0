import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsApi, connectionsApi } from '../services/api';
import { ArrowLeft, Save, Loader2, Info, HelpCircle, Play, CheckCircle, XCircle, Table, Layout, Database } from 'lucide-react';

// Components
import PivotBuilder from '../components/PivotBuilder';
import { PivotTable } from '../components/PivotTable';

// Tabs
const TABS = {
  QUERY: 'query',
  DESIGN: 'design'
};

export default function ReportEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(TABS.QUERY);
  
  // Test/Data State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean; 
    message: string; 
    rowCount?: number; 
    columns?: string[];
    sample_data?: any[];
  } | null>(null);

  const [connections, setConnections] = useState<any[]>([]);
  
  // Form State
  const [form, setForm] = useState({
    name: '',
    description: '',
    connection_id: 0,
    query: '',
    cache_enabled: true,
    cache_ttl: 3600,
    // Pivot Configuration
    default_group_by: [] as string[],
    default_metrics: [] as any[], // Stored as array of objects
    available_metrics: [] as any[],
    column_labels: {} as Record<string, string>,
    layout: {} as any // Store extra config like split_by here
  });

  // Local config for the Builder (synced with form)
  const [builderConfig, setBuilderConfig] = useState({
      group_by: [] as string[],
      split_by: [] as string[],
      metrics: [] as string[]
  });
  
  useEffect(() => {
    loadConnections();
    if (!isNew) loadReport();
  }, [id]);

  // Sync Form -> Builder Config when form loads
  useEffect(() => {
      if(!loading && form) {
          setBuilderConfig({
              group_by: form.default_group_by || [],
              split_by: form.layout?.split_by || [],
              metrics: (form.default_metrics || []).map((m: any) => m.field)
          });
      }
  }, [loading]);
  
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
        default_metrics: data.default_metrics || [],
        available_metrics: data.available_metrics || [],
        column_labels: data.column_labels || {},
        layout: data.layout || {}
      });
      
      // Also try to run a silent test if we have query to populate columns?
      // For now, user must hit 'Test' to get columns availability.
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
          columns: data.columns,
          sample_data: data.sample_data
        });
        
        // Auto-switch to Design if success
        if (data.columns && data.columns.length > 0) {
            // Keep user on Query tab so they see success message, or maybe show a toast?
            // Let's stay on current tab but enable Design.
        }
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

  // Handle updates from PivotBuilder
  const handleConfigChange = (newConfig: any) => {
      setBuilderConfig(newConfig); // Update local visual state
      
      // Update Form State
      setForm(prev => ({
          ...prev,
          default_group_by: newConfig.group_by,
          // Store metrics as objects
          default_metrics: newConfig.metrics.map((m: any) => ({
             field: m.field,
             aggregation: m.aggregation || 'SUM',
             name: m.field
          })),
          layout: {
              ...prev.layout,
              split_by: newConfig.split_by
          }
      }));
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-gray-50">
      
      {/* HEADER */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
         <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
               <ArrowLeft size={20} />
            </button>
            <div>
               <input 
                  type="text" 
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="Nome del Report"
                  className="font-bold text-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100 rounded px-1"
               />
               <div className="text-xs text-gray-400 flex items-center gap-2">
                 {isNew ? 'Nuovo Report' : `ID: ${id}`} 
                 {form.connection_id && <span>• {connections.find(c => c.id === form.connection_id)?.name}</span>}
               </div>
            </div>
         </div>
         
         <div className="flex items-center gap-2">
             <div className="flex bg-gray-100 rounded-lg p-1 mr-4">
                 <button 
                    onClick={() => setActiveTab(TABS.QUERY)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${activeTab === TABS.QUERY ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    <Database size={16}/> Dati
                 </button>
                 <button 
                    onClick={() => setActiveTab(TABS.DESIGN)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${activeTab === TABS.DESIGN ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                 >
                    <Layout size={16}/> Design
                 </button>
             </div>

             <button 
                onClick={() => handleSubmit()} 
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-sm flex items-center gap-2 text-sm font-medium disabled:opacity-50"
             >
                {saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}
                Salva
             </button>
         </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-hidden relative">
          
          {/* TAB: QUERY */}
          {activeTab === TABS.QUERY && (
             <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto">
                 <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
                    
                    {/* Connection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Connessione</label>
                      <select
                        value={form.connection_id}
                        onChange={e => setForm({ ...form, connection_id: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Seleziona --</option>
                        {connections.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.db_type})</option>
                        ))}
                      </select>
                    </div>

                    {/* SQL Editor */}
                    <div className="flex-1 flex flex-col min-h-[300px]">
                       <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-medium text-gray-700">Query SQL</label>
                          <div className="flex items-center gap-2">
                             <span className="text-xs text-gray-400">Ctrl+Enter per eseguire</span>
                             <button onClick={handleTestQuery} disabled={testing} className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1">
                                {testing ? <Loader2 size={14} className="animate-spin"/> : <Play size={14}/>} Test Query
                             </button>
                          </div>
                       </div>
                       <textarea
                          value={form.query}
                          onChange={e => setForm({...form, query: e.target.value})}
                          className="flex-1 w-full bg-slate-900 text-slate-100 font-mono text-sm p-4 rounded-lg resize-y min-h-[300px] border focus:ring-2 focus:ring-blue-500 outline-none"
                          spellCheck={false}
                          placeholder="SELECT * FROM ..."
                       />
                       
                       {/* Test Results */}
                       {testResult && (
                          <div className={`mt-4 p-4 rounded-lg border flex items-start gap-3 ${testResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                              {testResult.success ? <CheckCircle size={20} className="mt-0.5 text-green-600"/> : <XCircle size={20} className="mt-0.5 text-red-600"/>}
                              <div>
                                 <div className="font-semibold">{testResult.success ? 'Query Valida' : 'Errore SQL'}</div>
                                 <p className="text-sm mt-1">{testResult.message}</p>
                                 {testResult.rowCount !== undefined && (
                                     <div className="mt-2 text-xs bg-white/50 p-2 rounded inline-block border border-green-200">
                                        <span className="font-bold">{testResult.rowCount}</span> righe, 
                                        <span className="font-bold ml-1">{testResult.columns?.length}</span> colonne.
                                     </div>
                                 )}
                              </div>
                          </div>
                       )}
                    </div>
                 </div>
             </div>
          )}

          {/* TAB: DESIGN */}
          {activeTab === TABS.DESIGN && (
              <div className="h-full flex overflow-hidden">
                 
                 {/* Left Sidebar: PivotBuilder */}
                 <div className="h-full z-10 relative">
                    <PivotBuilder 
                        reportId={parseInt(id || '0')}
                        availableColumns={testResult?.columns || []}
                        initialConfig={{
                            group_by: builderConfig.group_by,
                            split_by: builderConfig.split_by,
                            metrics: builderConfig.metrics
                        }}
                        onConfigChange={handleConfigChange}
                    />
                    
                    {(!testResult?.columns || testResult.columns.length === 0) && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center p-6 text-center">
                            <div className="text-gray-500">
                                <Database size={48} className="mx-auto mb-2 opacity-20"/>
                                <p className="font-medium">Nessun dato disponibile</p>
                                <p className="text-xs mt-1">Esegui una query valida nel tab "Dati" per configurare il report.</p>
                                <button onClick={() => setActiveTab(TABS.QUERY)} className="mt-3 text-blue-600 hover:underline text-sm">Vai ai Dati</button>
                            </div>
                        </div>
                    )}
                 </div>

                 {/* Main Area: Preview */}
                 <div className="flex-1 bg-white flex flex-col overflow-hidden relative">
                    <div className="flex-1 relative overflow-auto">
                        <PivotTable 
                             data={testResult?.sample_data || []}
                             groupBy={builderConfig.group_by}
                             splitBy={builderConfig.split_by}
                             metrics={builderConfig.metrics.map(f => ({ field: f, aggregation: 'SUM' }))}
                        />
                         {(!testResult?.sample_data || testResult.sample_data.length === 0) && (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                                <div className="text-center">
                                    <Table size={48} className="mx-auto mb-2 opacity-20"/>
                                    <p>Anteprima dati</p>
                                    <p className="text-xs">Esegui la query per vedere i risultati</p>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Preview Footer */}
                    <div className="p-2 border-t bg-gray-50 text-xs text-gray-500 flex justify-between">
                        <span>Anteprima limitata ({testResult?.sample_data?.length || 0} righe)</span>
                        <span>Usare il Viewer per il dataset completo</span>
                    </div>
                 </div>
              </div>
          )}

      </div>
    </div>
  );
}

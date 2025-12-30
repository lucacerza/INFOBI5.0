import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { dashboardsApi } from '../services/api';
import PerspectiveViewer from '../components/PerspectiveViewer';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';

export default function DashboardViewerPage() {
  const { id } = useParams();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadDashboard();
  }, [id]);
  
  const loadDashboard = async () => {
    try {
      const data = await dashboardsApi.get(parseInt(id!));
      setDashboard(data);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  if (!dashboard) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Dashboard non trovata</p>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 p-4 bg-white border-b">
        <Link to="/dashboards" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">{dashboard.name}</h1>
      </div>
      
      <div className="flex-1 p-4 overflow-auto">
        {dashboard.widgets?.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Plus className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>Nessun widget. Aggiungi report a questa dashboard.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {dashboard.widgets?.map((widget: any) => (
              <div key={widget.id} className="bg-white rounded-xl border overflow-hidden" style={{ height: '500px' }}>
                <div className="px-4 py-3 border-b bg-gray-50">
                  <h3 className="font-medium">{widget.title || `Report ${widget.report_id}`}</h3>
                </div>
                <div className="h-[calc(100%-52px)]">
                  <PerspectiveViewer reportId={widget.report_id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

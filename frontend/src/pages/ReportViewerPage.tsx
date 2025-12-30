import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { reportsApi, exportApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import PerspectiveViewer from '../components/PerspectiveViewer';
import { 
  ArrowLeft, 
  Edit, 
  Download, 
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  FileText
} from 'lucide-react';

interface Report {
  id: number;
  name: string;
  description: string | null;
  cache_enabled: boolean;
}

export default function ReportViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  
  const reportId = parseInt(id || '0');
  
  useEffect(() => {
    loadReport();
  }, [id]);
  
  const loadReport = async () => {
    if (!id) return;
    try {
      const data = await reportsApi.get(reportId);
      setReport(data);
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleRefreshCache = async () => {
    setRefreshing(true);
    try {
      await reportsApi.refreshCache(reportId);
      // Trigger refresh in PerspectiveViewer by remounting
      setReport(null);
      setTimeout(() => loadReport(), 100);
    } catch (err) {
      console.error('Failed to refresh cache:', err);
    } finally {
      setRefreshing(false);
    }
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  if (!report) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-500">Report non trovato</p>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white border-b">
        <div className="flex items-center gap-3">
          <Link
            to="/reports"
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-800">{report.name}</h1>
            {report.description && (
              <p className="text-sm text-gray-500">{report.description}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Export dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">
              <Download className="w-4 h-4" />
              Esporta
            </button>
            <div className="absolute right-0 top-full mt-1 w-40 bg-white border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-10">
              <a
                href={exportApi.xlsx(reportId)}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                Excel (.xlsx)
              </a>
              <a
                href={exportApi.csv(reportId)}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileText className="w-4 h-4 text-blue-600" />
                CSV (.csv)
              </a>
            </div>
          </div>
          
          {/* Refresh cache */}
          {report.cache_enabled && (
            <button
              onClick={handleRefreshCache}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Aggiorna Cache
            </button>
          )}
          
          {/* Edit button */}
          {isAdmin && (
            <Link
              to={`/reports/${report.id}/edit`}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
            >
              <Edit className="w-4 h-4" />
              Modifica
            </Link>
          )}
        </div>
      </div>
      
      {/* Perspective Viewer */}
      <div className="flex-1 relative">
        <PerspectiveViewer 
          reportId={reportId}
          className="h-full"
        />
      </div>
    </div>
  );
}

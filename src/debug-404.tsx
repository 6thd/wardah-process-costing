import { useState, useEffect } from 'react';

export function Debug404() {
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkResources = async () => {
      setLoading(true);
      const resourcesToCheck = [
        '/src/assets/logo.svg',
        '/config.json',
        '/src/main.tsx',
        '/src/App.tsx'
      ];
      
      const results = [];
      
      for (const resource of resourcesToCheck) {
        try {
          const response = await fetch(resource);
          results.push({
            url: resource,
            status: response.status,
            ok: response.ok,
            statusText: response.statusText
          });
        } catch (error: any) {
          results.push({
            url: resource,
            status: 'Error',
            ok: false,
            error: error.message || 'Unknown error'
          });
        }
      }
      
      setResources(results);
      setLoading(false);
    };
    
    checkResources();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">404 Debug Information</h1>
      <p className="mb-4">This page helps diagnose missing resources that might be causing 404 errors.</p>
      
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Resource Status</h2>
          <table className="min-w-full border">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-2 border">Resource</th>
                <th className="text-left p-2 border">Status</th>
                <th className="text-left p-2 border">OK</th>
                <th className="text-left p-2 border">Details</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource, index) => (
                <tr key={index} className={resource.ok ? 'bg-green-50' : 'bg-red-50'}>
                  <td className="p-2 border font-mono">{resource.url}</td>
                  <td className="p-2 border">{resource.status}</td>
                  <td className="p-2 border">{resource.ok ? '✅' : '❌'}</td>
                  <td className="p-2 border">
                    {resource.error ? (
                      <span className="text-red-600">{resource.error}</span>
                    ) : (
                      resource.statusText
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      <div className="mt-8 p-4 bg-blue-50 rounded">
        <h2 className="text-xl font-semibold mb-2">Troubleshooting Steps</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Check if all referenced assets exist in the correct paths</li>
          <li>Verify that the public directory contains config.json</li>
          <li>Ensure the src/assets directory contains logo.svg</li>
          <li>Check browser developer tools Network tab for specific 404 errors</li>
          <li>Look for any missing CSS or JS files</li>
        </ul>
      </div>
    </div>
  );
}
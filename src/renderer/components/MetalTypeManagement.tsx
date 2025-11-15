import React, { useState, useEffect } from 'react';
import './MetalTypeManagement.css';

interface MetalType {
  id: number;
  symbol: string;
  name: string;
  price_per_unit: number;
  unit: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface MetalTypeManagementProps {
  onClose: () => void;
  onDataChange?: () => void; // 数据变更回调
}

const MetalTypeManagement: React.FC<MetalTypeManagementProps> = ({ onClose, onDataChange }) => {
  const [metalTypes, setMetalTypes] = useState<MetalType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingMetal, setEditingMetal] = useState<MetalType | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    symbol: '',
    name: '',
    price_per_unit: 0,
    unit: 'lb'
  });

  useEffect(() => {
    loadMetalTypes();
  }, []);

  const loadMetalTypes = async () => {
    try {
      setLoading(true);
      const data = await window.electronAPI.metalTypes.getAll();
      setMetalTypes(data);
    } catch (error) {
      console.error('Failed to load metal types:', error);
      showMessage('error', 'Failed to load metal types');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddMetal = async () => {
    if (!formData.symbol || !formData.name || formData.price_per_unit <= 0) {
      showMessage('error', 'Please fill in all required fields');
      return;
    }

    try {
      await window.electronAPI.metalTypes.create(formData);
      showMessage('success', 'Metal type added successfully');
      setFormData({ symbol: '', name: '', price_per_unit: 0, unit: 'lb' });
      setShowAddForm(false);
      loadMetalTypes();
      onDataChange?.(); // 通知父组件数据已变更
    } catch (error) {
      console.error('Failed to add metal type:', error);
      showMessage('error', 'Failed to add metal type');
    }
  };

  const handleEditMetal = async () => {
    if (!editingMetal) return;

    try {
      await window.electronAPI.metalTypes.update(editingMetal.id, {
        name: formData.name,
        price_per_unit: formData.price_per_unit,
        unit: formData.unit
      });
      showMessage('success', 'Metal type updated successfully');
      setEditingMetal(null);
      setFormData({ symbol: '', name: '', price_per_unit: 0, unit: 'lb' });
      loadMetalTypes();
      onDataChange?.(); // 通知父组件数据已变更
    } catch (error) {
      console.error('Failed to update metal type:', error);
      showMessage('error', 'Failed to update metal type');
    }
  };

  const handleDeleteMetal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this metal type?')) return;

    try {
      await window.electronAPI.metalTypes.delete(id);
      showMessage('success', 'Metal type deleted successfully');
      loadMetalTypes();
      onDataChange?.(); // 通知父组件数据已变更
    } catch (error) {
      console.error('Failed to delete metal type:', error);
      showMessage('error', 'Failed to delete metal type');
    }
  };

  const startEdit = (metal: MetalType) => {
    setEditingMetal(metal);
    setFormData({
      symbol: metal.symbol,
      name: metal.name,
      price_per_unit: metal.price_per_unit,
      unit: metal.unit
    });
  };

  const cancelEdit = () => {
    setEditingMetal(null);
    setFormData({ symbol: '', name: '', price_per_unit: 0, unit: 'lb' });
  };

  return (
    <div className="metal-type-management-overlay">
      <div className="metal-type-management-modal">
        <div className="metal-type-header">
          <h2>Metal Type Management</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="metal-type-content">
          <div className="metal-type-actions">
            <button 
              onClick={() => setShowAddForm(true)}
              className="add-metal-btn"
            >
              + Add Metal Type
            </button>
          </div>

          {message && (
            <div className={`message ${message.type}`}>
              {message.text}
            </div>
          )}

          {/* Add/Edit Form */}
          {(showAddForm || editingMetal) && (
            <div className="metal-type-form">
              <h3>{editingMetal ? 'Edit Metal Type' : 'Add New Metal Type'}</h3>
              
              <div className="form-group">
                <label>Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol}
                  onChange={(e) => setFormData({...formData, symbol: e.target.value})}
                  placeholder="e.g., Cu, Fe, Al"
                  disabled={!!editingMetal}
                />
              </div>

              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Copper, Iron, Aluminum"
                />
              </div>

              <div className="form-group">
                <label>Price per Unit *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.price_per_unit}
                  onChange={(e) => setFormData({...formData, price_per_unit: parseFloat(e.target.value) || 0})}
                  placeholder="0.00"
                />
              </div>

              <div className="form-group">
                <label>Unit</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({...formData, unit: e.target.value})}
                >
                  <option value="lb">Pound (lb)</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="oz">Ounce (oz)</option>
                </select>
              </div>

              <div className="form-actions">
                <button 
                  onClick={editingMetal ? handleEditMetal : handleAddMetal}
                  className="save-btn"
                >
                  {editingMetal ? 'Update' : 'Add'}
                </button>
                <button 
                  onClick={editingMetal ? cancelEdit : () => setShowAddForm(false)}
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Metal Types List */}
          <div className="metal-types-list">
            <h3>Metal Types ({metalTypes.length})</h3>
            
            {loading ? (
              <div className="loading">Loading metal types...</div>
            ) : metalTypes.length === 0 ? (
              <div className="no-metals">
                <p>No metal types found. Add your first metal type to get started.</p>
              </div>
            ) : (
              <table className="metals-table">
                <thead>
                  <tr>
                    <th>Metal Name</th>
                    <th>Unit Price</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {metalTypes.map(metal => (
                    <tr key={metal.id}>
                      <td className="metal-name-cell">
                        <span className="metal-symbol">{metal.symbol}</span>
                        <span className="metal-name">{metal.name}</span>
                      </td>
                      <td className="metal-price-cell">
                        ${metal.price_per_unit.toFixed(2)}/{metal.unit}
                      </td>
                      <td className="metal-actions-cell">
                        <button 
                          onClick={() => startEdit(metal)}
                          className="edit-btn"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteMetal(metal.id)}
                          className="delete-btn"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetalTypeManagement;

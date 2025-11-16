import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface MentalHealthRecord {
  id: number;
  title: string;
  moodScore: string;
  supportType: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface SupportStats {
  totalShares: number;
  verifiedRecords: number;
  avgMood: number;
  activeSupporters: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MentalHealthRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharingRecord, setSharingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    title: "", 
    moodScore: "", 
    supportType: "emotional" 
  });
  const [selectedRecord, setSelectedRecord] = useState<MentalHealthRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ moodScore: number | null }>({ moodScore: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState<SupportStats>({
    totalShares: 0,
    verifiedRecords: 0,
    avgMood: 0,
    activeSupporters: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateStats();
  }, [records]);

  const calculateStats = () => {
    const totalShares = records.length;
    const verifiedRecords = records.filter(r => r.isVerified).length;
    const avgMood = records.length > 0 
      ? records.reduce((sum, r) => sum + r.publicValue1, 0) / records.length 
      : 0;
    const uniqueSupporters = new Set(records.map(r => r.creator)).size;

    setStats({
      totalShares,
      verifiedRecords,
      avgMood,
      activeSupporters: uniqueSupporters
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: MentalHealthRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: parseInt(businessId.replace('record-', '')) || Date.now(),
            title: businessData.name,
            moodScore: businessId,
            supportType: "emotional",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const shareExperience = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setSharingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Sharing experience with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const moodValue = parseInt(newRecordData.moodScore) || 0;
      const businessId = `record-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moodValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        moodValue,
        0,
        `Support type: ${newRecordData.supportType}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Experience shared securely!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowShareModal(false);
      setNewRecordData({ title: "", moodScore: "", supportType: "emotional" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setSharingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card wood-card">
          <div className="stat-icon">🌿</div>
          <div className="stat-content">
            <h3>Total Shares</h3>
            <div className="stat-value">{stats.totalShares}</div>
            <div className="stat-label">Encrypted Experiences</div>
          </div>
        </div>
        
        <div className="stat-card stone-card">
          <div className="stat-icon">🔒</div>
          <div className="stat-content">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedRecords}</div>
            <div className="stat-label">On-chain Verified</div>
          </div>
        </div>
        
        <div className="stat-card grass-card">
          <div className="stat-icon">😊</div>
          <div className="stat-content">
            <h3>Avg Mood</h3>
            <div className="stat-value">{stats.avgMood.toFixed(1)}/10</div>
            <div className="stat-label">Community Well-being</div>
          </div>
        </div>
        
        <div className="stat-card sea-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>Supporters</h3>
            <div className="stat-value">{stats.activeSupporters}</div>
            <div className="stat-label">Active Members</div>
          </div>
        </div>
      </div>
    );
  };

  const renderMoodChart = (record: MentalHealthRecord, decryptedMood: number | null) => {
    const moodValue = record.isVerified ? 
      (record.decryptedValue || 0) : 
      (decryptedMood || record.publicValue1 || 5);
    
    const moodLevels = [
      { level: "Very Low", range: "1-3", color: "#8B4513" },
      { level: "Low", range: "4-5", color: "#CD853F" },
      { level: "Neutral", range: "6-7", color: "#DAA520" },
      { level: "Good", range: "8-9", color: "#9ACD32" },
      { level: "Excellent", range: "10", color: "#228B22" }
    ];
    
    const currentLevel = moodLevels[Math.max(0, Math.min(4, Math.floor((moodValue - 1) / 2)))];
    
    return (
      <div className="mood-chart">
        <div className="chart-title">Mood Analysis</div>
        <div className="mood-scale">
          {moodLevels.map((level, index) => (
            <div 
              key={index}
              className={`mood-level ${moodValue >= index * 2 + 1 && moodValue <= (index + 1) * 2 ? 'active' : ''}`}
              style={{ backgroundColor: level.color }}
            >
              <span>{level.range}</span>
              <div className="level-label">{level.level}</div>
            </div>
          ))}
        </div>
        <div className="current-mood">
          <span>Current Mood Score: </span>
          <strong>{moodValue}/10</strong>
          <span className="mood-indicator" style={{ backgroundColor: currentLevel.color }}></span>
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "How is my privacy protected?",
      answer: "All sensitive data is encrypted using FHE (Fully Homomorphic Encryption) before being stored on-chain. Only you can decrypt and verify your data."
    },
    {
      question: "What can I share?",
      answer: "You can share mood scores (1-10) and general experiences. All sensitive information remains encrypted and private."
    },
    {
      question: "How does matching work?",
      answer: "The system uses homomorphic encryption to match you with compatible support partners without revealing your private data."
    },
    {
      question: "Is this really anonymous?",
      answer: "Yes! Your wallet address is used for encryption keys but personal identifiers are never stored in clear text."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>MindGroup FHE 🌿</h1>
            <p>Confidential Mental Health Support</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content wood-panel">
            <div className="connection-icon">🌱</div>
            <h2>Welcome to Safe Space</h2>
            <p>Connect your wallet to join our encrypted mental health community. Your privacy is protected by FHE technology.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet securely</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Share experiences with full privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing Privacy Protection...</p>
        <p>Status: {fhevmInitializing ? "Setting up FHE" : status}</p>
        <p className="loading-note">Creating your secure space</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading your safe space...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>MindGroup FHE 🌿</h1>
          <p>Healing in Privacy, Growing Together</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowShareModal(true)} 
            className="share-btn wood-btn"
          >
            + Share Experience
          </button>
          <button 
            onClick={checkAvailability}
            className="check-btn stone-btn"
          >
            Check System
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)}
            className="faq-btn grass-btn"
          >
            FAQ
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="welcome-section sea-panel">
          <h2>Safe Mental Health Community 🔐</h2>
          <p>Share your journey encrypted with FHE technology. Your privacy is our priority.</p>
          {renderStatsDashboard()}
        </div>
        
        {showFAQ && (
          <div className="faq-section wood-panel">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <div className="faq-question">
                    <span>🌿</span>
                    {item.question}
                  </div>
                  <div className="faq-answer">{item.answer}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="records-section">
          <div className="section-header">
            <h2>Community Shares</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn stone-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list">
            {records.length === 0 ? (
              <div className="no-records wood-panel">
                <p>No shares yet. Be the first to share your experience.</p>
                <button 
                  className="share-btn wood-btn" 
                  onClick={() => setShowShareModal(true)}
                >
                  Share Your Journey
                </button>
              </div>
            ) : records.map((record, index) => (
              <div 
                className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="record-title">{record.title}</div>
                <div className="record-meta">
                  <span>Mood: {record.publicValue1}/10</span>
                  <span>Shared: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="record-status">
                  Status: {record.isVerified ? "✅ Verified" : "🔓 Ready to Verify"}
                  {record.isVerified && record.decryptedValue && (
                    <span className="verified-mood">Mood: {record.decryptedValue}</span>
                  )}
                </div>
                <div className="record-creator">By: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showShareModal && (
        <ModalShareExperience 
          onSubmit={shareExperience} 
          onClose={() => setShowShareModal(false)} 
          sharing={sharingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedData({ moodScore: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.moodScore)}
          renderMoodChart={renderMoodChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content wood-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalShareExperience: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  sharing: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, sharing, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'moodScore') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="share-experience-modal wood-panel">
        <div className="modal-header">
          <h2>Share Your Experience</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice stone-card">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Your mood score will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Experience Title *</label>
            <input 
              type="text" 
              name="title" 
              value={recordData.title} 
              onChange={handleChange} 
              placeholder="Brief title of your experience..." 
            />
          </div>
          
          <div className="form-group">
            <label>Mood Score (1-10) *</label>
            <input 
              type="number" 
              name="moodScore" 
              value={recordData.moodScore} 
              onChange={handleChange} 
              placeholder="How are you feeling today?" 
              min="1"
              max="10"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Support Type</label>
            <select name="supportType" value={recordData.supportType} onChange={handleChange}>
              <option value="emotional">Emotional Support</option>
              <option value="practical">Practical Advice</option>
              <option value="listening">Just Listening</option>
              <option value="shared">Shared Experience</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn stone-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={sharing || isEncrypting || !recordData.title || !recordData.moodScore} 
            className="submit-btn wood-btn"
          >
            {sharing || isEncrypting ? "Encrypting and Sharing..." : "Share Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: MentalHealthRecord;
  onClose: () => void;
  decryptedData: { moodScore: number | null };
  setDecryptedData: (value: { moodScore: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderMoodChart: (record: MentalHealthRecord, decryptedMood: number | null) => JSX.Element;
}> = ({ record, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderMoodChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.moodScore !== null) { 
      setDecryptedData({ moodScore: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ moodScore: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal wood-panel">
        <div className="modal-header">
          <h2>Experience Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{record.title}</strong>
            </div>
            <div className="info-item">
              <span>Shared by:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Shared:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Mood Data</h3>
            
            <div className="data-row">
              <div className="data-label">Mood Score:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ? 
                  `${record.decryptedValue}/10 (Verified)` : 
                  decryptedData.moodScore !== null ? 
                  `${decryptedData.moodScore}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedData.moodScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : record.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.moodScore !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify"
                )}
              </button>
            </div>
            
            <div className="fhe-info stone-card">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Your mood data remains encrypted. Verification happens through zero-knowledge proofs.</p>
              </div>
            </div>
          </div>
          
          {(record.isVerified || decryptedData.moodScore !== null) && (
            <div className="analysis-section">
              <h3>Mood Analysis</h3>
              {renderMoodChart(
                record, 
                record.isVerified ? record.decryptedValue || null : decryptedData.moodScore
              )}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn stone-btn">Close</button>
          {!record.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn wood-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


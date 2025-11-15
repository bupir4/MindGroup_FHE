pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MindGroupFHE is ZamaEthereumConfig {
    struct EncryptedExperience {
        euint32 encryptedData;
        uint256 publicMetadata;
        address owner;
        uint256 timestamp;
        bool isDecrypted;
        uint32 decryptedValue;
    }

    mapping(string => EncryptedExperience) private experienceRegistry;
    string[] private experienceIds;

    event ExperienceRegistered(string indexed experienceId, address indexed owner);
    event ExperienceDecrypted(string indexed experienceId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function registerEncryptedExperience(
        string calldata experienceId,
        externalEuint32 encryptedData,
        bytes calldata inputProof,
        uint256 publicMetadata
    ) external {
        require(experienceRegistry[experienceId].owner == address(0), "Experience ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedData, inputProof)), "Invalid encrypted input");

        experienceRegistry[experienceId] = EncryptedExperience({
            encryptedData: FHE.fromExternal(encryptedData, inputProof),
            publicMetadata: publicMetadata,
            owner: msg.sender,
            timestamp: block.timestamp,
            isDecrypted: false,
            decryptedValue: 0
        });

        FHE.allowThis(experienceRegistry[experienceId].encryptedData);
        FHE.makePubliclyDecryptable(experienceRegistry[experienceId].encryptedData);

        experienceIds.push(experienceId);
        emit ExperienceRegistered(experienceId, msg.sender);
    }

    function decryptExperience(
        string calldata experienceId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(experienceRegistry[experienceId].owner != address(0), "Experience does not exist");
        require(!experienceRegistry[experienceId].isDecrypted, "Experience already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(experienceRegistry[experienceId].encryptedData);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        experienceRegistry[experienceId].decryptedValue = decodedValue;
        experienceRegistry[experienceId].isDecrypted = true;

        emit ExperienceDecrypted(experienceId, decodedValue);
    }

    function getEncryptedExperience(string calldata experienceId) external view returns (
        euint32 encryptedData,
        uint256 publicMetadata,
        address owner,
        uint256 timestamp,
        bool isDecrypted,
        uint32 decryptedValue
    ) {
        require(experienceRegistry[experienceId].owner != address(0), "Experience does not exist");
        EncryptedExperience storage exp = experienceRegistry[experienceId];

        return (
            exp.encryptedData,
            exp.publicMetadata,
            exp.owner,
            exp.timestamp,
            exp.isDecrypted,
            exp.decryptedValue
        );
    }

    function getAllExperienceIds() external view returns (string[] memory) {
        return experienceIds;
    }

    function getExperienceCount() external view returns (uint256) {
        return experienceIds.length;
    }

    function verifyExperienceOwner(string calldata experienceId, address caller) external view returns (bool) {
        return experienceRegistry[experienceId].owner == caller;
    }

    function isExperienceDecrypted(string calldata experienceId) external view returns (bool) {
        return experienceRegistry[experienceId].isDecrypted;
    }

    function getPublicMetadata(string calldata experienceId) external view returns (uint256) {
        return experienceRegistry[experienceId].publicMetadata;
    }

    function getDecryptedValue(string calldata experienceId) external view returns (uint32) {
        require(experienceRegistry[experienceId].isDecrypted, "Experience not decrypted");
        return experienceRegistry[experienceId].decryptedValue;
    }

    function getExperienceTimestamp(string calldata experienceId) external view returns (uint256) {
        return experienceRegistry[experienceId].timestamp;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


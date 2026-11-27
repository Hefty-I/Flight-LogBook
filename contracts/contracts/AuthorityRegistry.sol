// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessBase} from "./base/AccessBase.sol";
import {IAuthorityRegistry} from "./interfaces/IAuthorityRegistry.sol";

/// @title AuthorityRegistry
/// @notice The aviation authorities (one per country or region), their licence rules,
///         and the consortium vote that admits new authorities or suspends a rogue one.
/// @dev The deployer may add the founding authorities once. After `sealGenesis()` the
///      deployer has no say in membership: only a majority of active authorities does.
contract AuthorityRegistry is AccessBase {
    /// @notice ICAO Annex 1 floor for a private pilot licence: 40 hours.
    uint32 public constant ICAO_MIN_TOTAL_MINUTES = 40 * 60;
    uint16 public constant MAX_BPS = 10_000;
    uint256 public constant VOTING_PERIOD = 7 days;

    enum ProposalKind {
        AddAuthority,
        SuspendAuthority
    }

    struct Authority {
        address admin; // slot 0 (20 bytes)
        bool active; //   slot 0 (+1 byte)
        IAuthorityRegistry.RuleSet rules; // slot 1 (18 bytes)
        string name;
    }

    struct Proposal {
        ProposalKind kind;
        uint32 targetId; // SuspendAuthority only
        uint32 proposerAuthority;
        uint16 yesVotes;
        uint40 deadline;
        bool executed;
        address newAdmin; // AddAuthority only
        IAuthorityRegistry.RuleSet rules; // AddAuthority only
        string name; // AddAuthority only
    }

    uint32 public authorityCount;
    uint32 public activeAuthorityCount;
    bool public genesisSealed;
    uint256 public proposalCount;

    mapping(uint32 => Authority) private _authorities;
    /// @notice Which authority a wallet administers (0 = none). One wallet, one authority.
    mapping(address => uint32) public adminOf;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(uint32 => bool)) public hasVoted;

    event AuthorityAdded(uint32 indexed authorityId, string name, address indexed admin);
    event AuthoritySuspended(uint32 indexed authorityId);
    event AuthorityAdminChanged(uint32 indexed authorityId, address indexed oldAdmin, address indexed newAdmin);
    event RulesUpdated(uint32 indexed authorityId, IAuthorityRegistry.RuleSet rules);
    event GenesisClosed(uint32 foundingAuthorities);
    event ProposalCreated(
        uint256 indexed proposalId,
        ProposalKind kind,
        uint32 indexed proposerAuthority,
        uint32 targetId,
        address newAdmin,
        uint40 deadline
    );
    event VoteCast(uint256 indexed proposalId, uint32 indexed authorityId, uint16 yesVotes);
    event ProposalExecuted(uint256 indexed proposalId, uint32 authorityId);

    error GenesisAlreadySealed();
    error GenesisNotSealed();
    error NoAuthorities();
    error EmptyName();
    error AlreadyAdmin(address account);
    error InvalidRules();
    error RulesBelowIcaoMinimum(uint32 minTotalMinutes);
    error UnknownAuthority(uint32 authorityId);
    error AuthorityInactive(uint32 authorityId);
    error NotActiveAuthorityAdmin(address caller);
    error ProposalNotFound(uint256 proposalId);
    error ProposalClosed(uint256 proposalId);
    error AlreadyVoted(uint256 proposalId, uint32 authorityId);
    error CannotTargetOwnAuthority();

    constructor(address admin) AccessBase(admin) {}

    // ───────────────────────── Founding authorities ─────────────────────────

    function addFoundingAuthority(
        string calldata name,
        address admin,
        IAuthorityRegistry.RuleSet calldata rules
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint32 authorityId) {
        if (genesisSealed) revert GenesisAlreadySealed();
        authorityId = _createAuthority(name, admin, rules);
    }

    /// @notice Ends the bootstrap phase. From now on only a vote can change membership.
    function sealGenesis() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (activeAuthorityCount == 0) revert NoAuthorities();
        genesisSealed = true;
        emit GenesisClosed(activeAuthorityCount);
    }

    // ───────────────────────── Consortium voting ─────────────────────────

    function proposeAuthority(
        string calldata name,
        address admin,
        IAuthorityRegistry.RuleSet calldata rules
    ) external whenSystemActive returns (uint256 proposalId) {
        uint32 voter = _requireActiveAdmin(msg.sender);
        if (!genesisSealed) revert GenesisNotSealed();
        _validateNewAuthority(name, admin, rules);

        proposalId = ++proposalCount;
        Proposal storage p = _proposals[proposalId];
        p.kind = ProposalKind.AddAuthority;
        p.proposerAuthority = voter;
        p.deadline = uint40(block.timestamp + VOTING_PERIOD);
        p.newAdmin = admin;
        p.rules = rules;
        p.name = name;

        emit ProposalCreated(proposalId, p.kind, voter, 0, admin, p.deadline);
        _castVote(proposalId, voter);
    }

    function proposeSuspension(uint32 targetId) external whenSystemActive returns (uint256 proposalId) {
        uint32 voter = _requireActiveAdmin(msg.sender);
        if (!genesisSealed) revert GenesisNotSealed();
        if (targetId == voter) revert CannotTargetOwnAuthority();
        if (!_authorities[targetId].active) revert AuthorityInactive(targetId);

        proposalId = ++proposalCount;
        Proposal storage p = _proposals[proposalId];
        p.kind = ProposalKind.SuspendAuthority;
        p.targetId = targetId;
        p.proposerAuthority = voter;
        p.deadline = uint40(block.timestamp + VOTING_PERIOD);

        emit ProposalCreated(proposalId, p.kind, voter, targetId, address(0), p.deadline);
        _castVote(proposalId, voter);
    }

    /// @notice A "yes" vote. Not voting counts as "no". Executes on a strict majority.
    function vote(uint256 proposalId) external whenSystemActive {
        uint32 voter = _requireActiveAdmin(msg.sender);
        Proposal storage p = _proposals[proposalId];
        if (p.deadline == 0) revert ProposalNotFound(proposalId);
        if (p.executed || block.timestamp > p.deadline) revert ProposalClosed(proposalId);
        _castVote(proposalId, voter);
    }

    // ───────────────────────── Authority self-service ─────────────────────────

    function updateRules(
        uint32 authorityId,
        IAuthorityRegistry.RuleSet calldata rules
    ) external whenSystemActive {
        Authority storage a = _requireOwnAuthority(authorityId);
        _validateRules(rules);
        a.rules = rules;
        emit RulesUpdated(authorityId, rules);
    }

    /// @notice Key rotation: hand the authority to a new wallet.
    function transferAuthorityAdmin(uint32 authorityId, address newAdmin) external whenSystemActive {
        Authority storage a = _requireOwnAuthority(authorityId);
        if (newAdmin == address(0)) revert ZeroAddress();
        if (adminOf[newAdmin] != 0) revert AlreadyAdmin(newAdmin);
        address oldAdmin = a.admin;
        delete adminOf[oldAdmin];
        adminOf[newAdmin] = authorityId;
        a.admin = newAdmin;
        emit AuthorityAdminChanged(authorityId, oldAdmin, newAdmin);
    }

    // ───────────────────────── Views ─────────────────────────

    function isActiveAdmin(uint32 authorityId, address account) external view returns (bool) {
        Authority storage a = _authorities[authorityId];
        return a.active && a.admin == account;
    }

    function isActive(uint32 authorityId) external view returns (bool) {
        return _authorities[authorityId].active;
    }

    function rulesOf(uint32 authorityId) external view returns (IAuthorityRegistry.RuleSet memory) {
        Authority storage a = _authorities[authorityId];
        if (a.admin == address(0)) revert UnknownAuthority(authorityId);
        return a.rules;
    }

    function getAuthority(
        uint32 authorityId
    )
        external
        view
        returns (string memory name, address admin, bool active, IAuthorityRegistry.RuleSet memory rules)
    {
        Authority storage a = _authorities[authorityId];
        if (a.admin == address(0)) revert UnknownAuthority(authorityId);
        return (a.name, a.admin, a.active, a.rules);
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        if (_proposals[proposalId].deadline == 0) revert ProposalNotFound(proposalId);
        return _proposals[proposalId];
    }

    // ───────────────────────── Internals ─────────────────────────

    function _castVote(uint256 proposalId, uint32 voter) private {
        if (hasVoted[proposalId][voter]) revert AlreadyVoted(proposalId, voter);
        hasVoted[proposalId][voter] = true;

        Proposal storage p = _proposals[proposalId];
        uint16 yes = ++p.yesVotes;
        emit VoteCast(proposalId, voter, yes);

        if (uint256(yes) * 2 > activeAuthorityCount) {
            _execute(proposalId, p);
        }
    }

    function _execute(uint256 proposalId, Proposal storage p) private {
        p.executed = true;
        if (p.kind == ProposalKind.AddAuthority) {
            uint32 newId = _createAuthority(p.name, p.newAdmin, p.rules);
            emit ProposalExecuted(proposalId, newId);
        } else {
            Authority storage target = _authorities[p.targetId];
            if (!target.active) revert AuthorityInactive(p.targetId);
            target.active = false;
            --activeAuthorityCount;
            emit AuthoritySuspended(p.targetId);
            emit ProposalExecuted(proposalId, p.targetId);
        }
    }

    function _createAuthority(
        string memory name,
        address admin,
        IAuthorityRegistry.RuleSet memory rules
    ) private returns (uint32 authorityId) {
        _validateNewAuthority(name, admin, rules);
        authorityId = ++authorityCount;
        Authority storage a = _authorities[authorityId];
        a.admin = admin;
        a.active = true;
        a.rules = rules;
        a.name = name;
        adminOf[admin] = authorityId;
        ++activeAuthorityCount;
        emit AuthorityAdded(authorityId, name, admin);
        emit RulesUpdated(authorityId, rules);
    }

    function _validateNewAuthority(
        string memory name,
        address admin,
        IAuthorityRegistry.RuleSet memory rules
    ) private view {
        if (bytes(name).length == 0) revert EmptyName();
        if (admin == address(0)) revert ZeroAddress();
        if (adminOf[admin] != 0) revert AlreadyAdmin(admin);
        _validateRules(rules);
    }

    /// @dev Even a regulator cannot set rules below the ICAO floor or rules that contradict themselves.
    function _validateRules(IAuthorityRegistry.RuleSet memory r) private pure {
        if (r.minTotalMinutes < ICAO_MIN_TOTAL_MINUTES) revert RulesBelowIcaoMinimum(r.minTotalMinutes);
        if (r.minVerifiedBps > MAX_BPS) revert InvalidRules();
        if (uint256(r.minDualMinutes) + r.minSoloMinutes > r.minTotalMinutes) revert InvalidRules();
        if (r.minCrossCountryMinutes > r.minTotalMinutes) revert InvalidRules();
    }

    function _requireActiveAdmin(address account) private view returns (uint32 authorityId) {
        authorityId = adminOf[account];
        if (authorityId == 0 || !_authorities[authorityId].active) revert NotActiveAuthorityAdmin(account);
    }

    function _requireOwnAuthority(uint32 authorityId) private view returns (Authority storage a) {
        a = _authorities[authorityId];
        if (!a.active || a.admin != msg.sender) revert NotActiveAuthorityAdmin(msg.sender);
    }
}

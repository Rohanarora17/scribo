// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ChartPredictionMultiPoolV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Round {
        address owner;
        IERC20 token;
        uint256 entryFee;
        uint256 maxParticipants;
        bool open;
        bool started;
        bool finished;
        address[] players;
        mapping(address => bool) hasJoined;
        address winner;
        bool prizeClaimed;
    }

    uint256 public nextRoundId = 1;
    mapping(uint256 => Round) private rounds;
    mapping(address => uint256) public userOpenRound; // user => open roundId (0 if none)

    event RoundCreated(
        uint256 indexed roundId,
        address indexed creator,
        address token,
        uint256 entryFee,
        uint256 maxParticipants
    );
    event RoundStarted(uint256 indexed roundId);
    event PoolJoined(uint256 indexed roundId, address indexed player);
    event RoundClosed(uint256 indexed roundId, address winner);
    event PrizeClaimed(uint256 indexed roundId, address winner, uint256 amount, address token);

    modifier onlyRoundOwner(uint256 roundId) {
        require(rounds[roundId].owner == msg.sender, "Not round owner");
        _;
    }
    modifier roundExists(uint256 roundId) {
        require(rounds[roundId].owner != address(0), "Round does not exist");
        _;
    }

    function createRound(
        address _token,
        uint256 _entryFee,
        uint256 _maxParticipants
    ) external returns (uint256 roundId) {
        require(userOpenRound[msg.sender] == 0, "User already has open round");
        require(_token != address(0), "Token required");
        require(_entryFee > 0, "Entry fee > 0");
        require(_maxParticipants > 1, "At least 2 participants");

        roundId = nextRoundId++;
        Round storage r = rounds[roundId];
        r.owner = msg.sender;
        r.token = IERC20(_token);
        r.entryFee = _entryFee;
        r.maxParticipants = _maxParticipants;
        r.open = true;
        r.started = false;
        r.finished = false;

        userOpenRound[msg.sender] = roundId;

        emit RoundCreated(roundId, msg.sender, _token, _entryFee, _maxParticipants);
    }

    function startRound(uint256 roundId) external onlyRoundOwner(roundId) roundExists(roundId) {
        Round storage r = rounds[roundId];
        require(r.open, "Round not open");
        require(!r.started, "Round already started");
        require(r.players.length >= 2, "Not enough participants");
        r.started = true;
        emit RoundStarted(roundId);
    }

    function joinPool(uint256 roundId) external nonReentrant roundExists(roundId) {
        Round storage r = rounds[roundId];
        require(r.open && !r.started && !r.finished, "Join phase not open");
        require(!r.hasJoined[msg.sender], "Already joined");
        require(r.players.length < r.maxParticipants, "Round full");
        require(r.token.allowance(msg.sender, address(this)) >= r.entryFee, "Insufficient allowance");
        require(r.token.balanceOf(msg.sender) >= r.entryFee, "Insufficient balance");

        r.token.safeTransferFrom(msg.sender, address(this), r.entryFee);

        r.players.push(msg.sender);
        r.hasJoined[msg.sender] = true;
        emit PoolJoined(roundId, msg.sender);

        // Auto-close pool if full
        if (r.players.length == r.maxParticipants) {
            r.started = true;
            emit RoundStarted(roundId);
        }
    }

    // Only round creator can close the round and declare the winner
    function closeRound(uint256 roundId, address winner) external onlyRoundOwner(roundId) roundExists(roundId) {
        Round storage r = rounds[roundId];
        require(r.started, "Round not started");
        require(!r.finished, "Round already finished");
        require(winner != address(0), "Winner required");
        require(r.hasJoined[winner], "Winner not participant");

        r.finished = true;
        r.open = false;
        r.winner = winner;
        userOpenRound[msg.sender] = 0;

        emit RoundClosed(roundId, winner);
    }

    // Winner can claim the total pool
    function claimPrize(uint256 roundId) external nonReentrant roundExists(roundId) {
        Round storage r = rounds[roundId];
        require(r.finished, "Round not finished");
        require(r.winner == msg.sender, "Not winner");
        require(!r.prizeClaimed, "Already claimed");

        uint256 pool = r.players.length * r.entryFee;
        r.prizeClaimed = true;
        r.token.safeTransfer(msg.sender, pool);

        emit PrizeClaimed(roundId, msg.sender, pool, address(r.token));
    }

    // --- VIEWS ---

    function getRoundInfo(uint256 roundId)
        external
        view
        returns (
            address owner,
            address token,
            uint256 entryFee,
            uint256 maxParticipants,
            bool open,
            bool started,
            bool finished,
            uint256 numPlayers,
            address winner,
            bool prizeClaimed
        )
    {
        Round storage r = rounds[roundId];
        owner = r.owner;
        token = address(r.token);
        entryFee = r.entryFee;
        maxParticipants = r.maxParticipants;
        open = r.open;
        started = r.started;
        finished = r.finished;
        numPlayers = r.players.length;
        winner = r.winner;
        prizeClaimed = r.prizeClaimed;
    }

    function getPlayers(uint256 roundId) external view returns (address[] memory) {
        return rounds[roundId].players;
    }
}

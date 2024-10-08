import React, { useEffect, useState } from "react";
import Threads from "@components/images/Threads.svg";
import search from "@components/images/search.svg";
import styled from "styled-components";
import { setThreads, settogglesidebar } from "@Redux/sessionSlice";
import { useDispatch, useSelector } from "react-redux";
import rightarrow from "@images/rightarrow.svg";
import backbutton from "@components/images/leftarrow.svg";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { current } from "@reduxjs/toolkit";

const Usernavbar = () => {
  const [Thread, setThread] = useState(false);
  const [user, setuser] = useState();
  const { userId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [currentWidth, setCurrentwidth] = useState(window.innerWidth);

  useEffect(() => {
    console.log(currentWidth);
    const handleResize = () => {
      setCurrentwidth(window.innerWidth);
      console.log(currentWidth);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [currentWidth, currentWidth]);

  const handleThreadclick = () => {
    setThread(!Thread);
    dispatch(setThreads(!Thread));
  };

  const { togglesidebar } = useSelector((state) => state.counterSlice);

  const handleSidebar = () => {
    if (currentWidth < 1024) {
      navigate("/@me");

      return;
    }

    dispatch(settogglesidebar(true));
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await axios.get(
          `/api/users/specificuser/oneuser/${userId}`
        );
        setuser(response.data);
      } catch (error) {
        console.error("Error fetching user:", error);
      }
    };

    fetchUser();
  }, [userId]);

  return (
    <Cover>
      <div className="saparator">
        <Firstdiv>
          <img
            onClick={() => handleSidebar()}
            className="Backbutton"
            src={backbutton}
            alt=""
          />
          <img className="titlehas" src={Threads} alt="" />
          <p>{user && user?.username}</p>
          {/* <img className="hiddenrightarrow" src={rightarrow} alt="" /> */}
        </Firstdiv>
      </div>
      <Thirddiv>
        <div className="Innerdiv">
          <div className="firstdivnoti">
            <img
              onClick={() => handleThreadclick()}
              style={{ cursor: "pointer" }}
              src={Threads}
              alt=""
            />
          </div>
          <div className="seconddivnoti">
            <input type="text" />
            <img src={search} alt="" />
          </div>
          <div className="Thirddivnoti"></div>
        </div>
      </Thirddiv>
    </Cover>
  );
};

export default Usernavbar;

const Cover = styled.div`
  width: 100%;
  min-height: 3rem;
  background-color: #313338;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #1e1f22;
  .saparator {
    display: flex;
    align-items: center;
    gap: 1rem;
    position: relative;
  }
  @media (max-width: 1024px) {
    width: 100vw;
  }
`;
const Firstdiv = styled.div`
  width: 7rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: white;

  border-right: 1px solid #3f4147;
  .Backbutton {
    width: 1rem;
    margin-left: 0.8rem;
    cursor: pointer;
    display: none;
    @media (max-width: 1024px) {
      display: block;
    }
  }
  @media (max-width: 1024px) {
    gap: 0.3;
    border: none;
  }
  .titlehas {
    width: 1.5rem;
    margin-left: 0.5rem;
  }
  .hiddenrightarrow {
    width: 0.6rem;
    display: none;
    @media (max-width: 1024px) {
      display: block;
    }
  }
  p {
    font-weight: medium;
    margin-left: 0.2rem;
  }
`;
const Secondiv = styled.div`
  display: flex;
  max-width: 60%;
  color: white;
  font-size: 0.8rem;
  position: absolute;
  left: 8.2rem;
  z-index: 0;
  @media (max-width: 1024px) {
    display: none;
  }
`;
const Thirddiv = styled.div`
  display: flex;
  width: 24rem;
  margin-right: 0.5rem;
  padding-left: 1rem;
  align-items: center;
  position: relative;
  z-index: 1;
  background-color: #313338;
  @media (max-width: 1024px) {
    display: none;
  }
  .Innerdiv {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .firstdivnoti {
      display: flex;
      gap: 1rem;
      margin-right: 0.3rem;
    }
    .seconddivnoti {
      display: flex;
      width: 10.5rem;
      height: 1.5rem;
      justify-content: space-around;
      background-color: #1e1f22;
      border-radius: 0.2rem;
      input {
        width: 7rem;
        outline: none;
        border: none;
        background-color: transparent;
        color: white;
      }
      img {
        width: 1.2rem;
      }
    }
    .Thirddivnoti {
      display: flex;
      gap: 0.7rem;
    }
  }
`;
